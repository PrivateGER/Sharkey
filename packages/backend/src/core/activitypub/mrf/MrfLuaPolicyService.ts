/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { LuaFactory } from 'wasmoon';
import type { IActivity } from '@/core/activitypub/type.js';

export type MrfLuaPolicy = {
	id: string;
	name: string;
	source: string;
	timeoutMs?: number;
	paramsSchema?: MrfLuaParamsSchema;
	params?: MrfLuaParams;
};

export type MrfLuaPolicyContext = {
	activity: IActivity;
	params?: MrfLuaParams;
	actor: {
		uri: string;
		host: string | null;
		followersCount?: number;
		followingCount?: number;
	};
	localHost: string;
	signerHost: string;
	receivedAt: string;
};

export type MrfLuaDecision =
	| { action: 'accept'; reason?: string }
	| { action: 'reject'; reason: string }
	| { action: 'rewrite'; activity: IActivity; reason?: string };

export type MrfLuaRunResult = {
	policy: Pick<MrfLuaPolicy, 'id' | 'name'>;
	decision: MrfLuaDecision;
	durationMs: number;
};

export type MrfLuaLookupApi = {
	userByUri?: (uri: string) => Promise<Record<string, unknown> | null>;
	userByMention?: (mention: Record<string, unknown> | string) => Promise<Record<string, unknown> | null>;
	instanceByHost?: (host: string) => Promise<Record<string, unknown> | null>;
	noteByUri?: (uri: string) => Promise<Record<string, unknown> | null>;
};

export type MrfLuaParamType = 'string' | 'boolean' | 'number' | 'integer' | 'string_array';

export type MrfLuaParamSchemaEntry = {
	type: MrfLuaParamType;
	default?: string | boolean | number | string[];
	label?: string;
	description?: string;
};

export type MrfLuaParamsSchema = Record<string, MrfLuaParamSchemaEntry>;
export type MrfLuaParams = Record<string, unknown>;

export type MrfLuaRunOptions = {
	lookup?: MrfLuaLookupApi;
};

export type MrfLuaPolicyServiceOptions = {
	defaultTimeoutMs: number;
	defaultMemoryLimitBytes: number;
};

const DEFAULT_OPTIONS = {
	defaultTimeoutMs: 50,
	defaultMemoryLimitBytes: 1024 * 1024 * 8,
} satisfies MrfLuaPolicyServiceOptions;

const SANDBOX_PRELUDE = `
	os = nil
	io = nil
	package = nil
	require = nil
	debug = nil
	dofile = nil
	loadfile = nil
	load = nil
	collectgarbage = nil
	Promise = nil
	Error = nil

	local __mrf_null = rawget(_G, "null")
	local __mrf_accept_fn = __mrf_accept
	local __mrf_reject_fn = __mrf_reject
	local __mrf_rewrite_fn = __mrf_rewrite
	local __mrf_lookup_user_by_uri_fn = __mrf_lookup_user_by_uri
	local __mrf_lookup_user_by_mention_fn = __mrf_lookup_user_by_mention
	local __mrf_lookup_instance_by_host_fn = __mrf_lookup_instance_by_host
	local __mrf_lookup_note_by_uri_fn = __mrf_lookup_note_by_uri

	null = nil
	__mrf_accept = nil
	__mrf_reject = nil
	__mrf_rewrite = nil
	__mrf_lookup_user_by_uri = nil
	__mrf_lookup_user_by_mention = nil
	__mrf_lookup_instance_by_host = nil
	__mrf_lookup_note_by_uri = nil

	mrf = {}

	function mrf.is_nil(value)
		return value == nil or value == __mrf_null
	end

	function mrf.accept(reason)
		return __mrf_accept_fn(reason)
	end

	function mrf.reject(reason)
		return __mrf_reject_fn(reason)
	end

	function mrf.rewrite(activity, reason)
		return __mrf_rewrite_fn(activity, reason)
	end

	mrf.activity = {}

	function mrf.activity.object(activity)
		if type(activity) ~= "table" then
			return nil
		end
		return activity.object
	end

	function mrf.activity.type(activity)
		if type(activity) ~= "table" then
			return nil
		end
		return activity.type
	end

	function mrf.activity.actor_uri(activity)
		if type(activity) ~= "table" then
			return nil
		end
		if type(activity.actor) == "string" then
			return activity.actor
		end
		if type(activity.actor) == "table" then
			return activity.actor.id
		end
		return nil
	end

	function mrf.activity.note(activity)
		if type(activity) ~= "table" or activity.type ~= "Create" then
			return nil
		end
		local object = activity.object
		if type(object) ~= "table" or object.type ~= "Note" then
			return nil
		end
		return object
	end

	mrf.note = {}

	function mrf.note.content(note)
		if type(note) ~= "table" then
			return nil
		end
		return note.content
	end

	function mrf.note.mentions(note)
		local mentions = {}
		if type(note) ~= "table" or type(note.tag) ~= "table" then
			return mentions
		end
		for _, tag in ipairs(note.tag) do
			if type(tag) == "table" and tag.type == "Mention" then
				mentions[#mentions + 1] = tag
			end
		end
		return mentions
	end

	function mrf.note.mention_count(note)
		return #mrf.note.mentions(note)
	end

	function mrf.note.remove_mentions(note)
		if type(note) ~= "table" or type(note.tag) ~= "table" then
			return note
		end
		local tags = {}
		for _, tag in ipairs(note.tag) do
			if type(tag) ~= "table" or tag.type ~= "Mention" then
				tags[#tags + 1] = tag
			end
		end
		note.tag = tags
		return note
	end

	function mrf.note.mark_sensitive(note, reason)
		if type(note) ~= "table" then
			return note
		end
		note.sensitive = true
		if reason ~= nil and note.summary == nil then
			note.summary = reason
		end
		return note
	end

	function mrf.note.unlist(note)
		if type(note) ~= "table" then
			return note
		end
		local public = "https://www.w3.org/ns/activitystreams#Public"
		local to = note.to
		local cc = note.cc
		if type(to) == "string" and to == public then
			note.to = cc
			note.cc = public
		end
		return note
	end

	function mrf.note.has_media(note)
		return type(note) == "table" and type(note.attachment) == "table" and #note.attachment > 0
	end

	mrf.lookup = {}

	local function __mrf_nil_if_null(value)
		if mrf.is_nil(value) then
			return nil
		end
		return value
	end

	function mrf.lookup.user_by_uri(uri)
		if type(uri) ~= "string" then
			return nil
		end
		return __mrf_nil_if_null(__mrf_lookup_user_by_uri_fn(uri):await())
	end

	function mrf.lookup.user_by_mention(mention)
		if type(mention) ~= "table" and type(mention) ~= "string" then
			return nil
		end
		return __mrf_nil_if_null(__mrf_lookup_user_by_mention_fn(mention):await())
	end

	function mrf.lookup.instance_by_host(host)
		if type(host) ~= "string" then
			return nil
		end
		return __mrf_nil_if_null(__mrf_lookup_instance_by_host_fn(host):await())
	end

	function mrf.lookup.note_by_uri(uri)
		if type(uri) ~= "string" then
			return nil
		end
		return __mrf_nil_if_null(__mrf_lookup_note_by_uri_fn(uri):await())
	end
`;

export class MrfLuaPolicyError extends Error {
	constructor(policy: Pick<MrfLuaPolicy, 'id' | 'name'>, cause: unknown) {
		super(`policy ${policy.id} failed: ${renderLuaError(cause)}`);
		this.name = 'MrfLuaPolicyError';
	}
}

export class MrfLuaPolicyService {
	private readonly luaFactory = new LuaFactory();
	private readonly options: MrfLuaPolicyServiceOptions;

	constructor(options?: Partial<MrfLuaPolicyServiceOptions>) {
		this.options = {
			...DEFAULT_OPTIONS,
			...options,
		};
	}

	public async run(policy: MrfLuaPolicy, context: MrfLuaPolicyContext, options: MrfLuaRunOptions = {}): Promise<MrfLuaRunResult> {
		const start = performance.now();
		const timeoutMs = policy.timeoutMs ?? this.options.defaultTimeoutMs;
		const paramsSchema = policy.paramsSchema ?? await this.extractParamsSchema(policy);
		const params = this.resolveParams(paramsSchema, {
			...policy.params,
			...context.params,
		});
		const clonedContext = structuredClone({
			...context,
			params,
		});

		const lua = await this.luaFactory.createEngine({
			openStandardLibs: true,
			injectObjects: true,
			enableProxy: false,
			traceAllocations: true,
			functionTimeout: timeoutMs,
		});

		try {
			const mrfApi = this.createMrfApi();
			lua.global.setMemoryMax(this.options.defaultMemoryLimitBytes);
			lua.global.set('__mrf_accept', mrfApi.accept);
			lua.global.set('__mrf_reject', mrfApi.reject);
			lua.global.set('__mrf_rewrite', mrfApi.rewrite);
			lua.global.set('__mrf_lookup_user_by_uri', options.lookup?.userByUri ?? (async () => null));
			lua.global.set('__mrf_lookup_user_by_mention', options.lookup?.userByMention ?? (async () => null));
			lua.global.set('__mrf_lookup_instance_by_host', options.lookup?.instanceByHost ?? (async () => null));
			lua.global.set('__mrf_lookup_note_by_uri', options.lookup?.noteByUri ?? (async () => null));
			lua.global.set('ctx', clonedContext);
			await lua.doString(SANDBOX_PRELUDE);
			await this.runString(lua, policy.source, policy.name, timeoutMs);

			const thread = lua.global.newThread();
			thread.loadString('return filter(ctx)', policy.name);
			const returns = await thread.run(0, { timeout: timeoutMs });
			const decision = this.parseDecision(returns[0], clonedContext.activity);

			return {
				policy: {
					id: policy.id,
					name: policy.name,
				},
				decision,
				durationMs: performance.now() - start,
			};
		} catch (error) {
			throw new MrfLuaPolicyError(policy, error);
		} finally {
			lua.global.close();
		}
	}

	public async extractParamsSchema(policy: Pick<MrfLuaPolicy, 'id' | 'name' | 'source' | 'timeoutMs'>): Promise<MrfLuaParamsSchema> {
		const timeoutMs = policy.timeoutMs ?? this.options.defaultTimeoutMs;
		const lua = await this.luaFactory.createEngine({
			openStandardLibs: true,
			injectObjects: true,
			enableProxy: false,
			traceAllocations: true,
			functionTimeout: timeoutMs,
		});

		try {
			lua.global.setMemoryMax(this.options.defaultMemoryLimitBytes);
			lua.global.set('__mrf_accept', this.createMrfApi().accept);
			lua.global.set('__mrf_reject', this.createMrfApi().reject);
			lua.global.set('__mrf_rewrite', this.createMrfApi().rewrite);
			lua.global.set('__mrf_lookup_user_by_uri', async () => null);
			lua.global.set('__mrf_lookup_user_by_mention', async () => null);
			lua.global.set('__mrf_lookup_instance_by_host', async () => null);
			lua.global.set('__mrf_lookup_note_by_uri', async () => null);
			await lua.doString(SANDBOX_PRELUDE);
			await this.runString(lua, policy.source, policy.name, timeoutMs);
			const rawPolicy = lua.global.get('policy');

			if (!isRecord(rawPolicy) || rawPolicy.params == null) {
				return {};
			}

			return this.parseParamsSchema(rawPolicy.params);
		} catch (error) {
			throw new MrfLuaPolicyError(policy, error);
		} finally {
			lua.global.close();
		}
	}

	public resolveParams(schema: MrfLuaParamsSchema, params: MrfLuaParams = {}): MrfLuaParams {
		const parsedParams = this.filterCompatibleParams(schema, params);
		const resolved: MrfLuaParams = {};
		for (const [key, entry] of Object.entries(schema)) {
			if (Object.hasOwn(parsedParams, key)) {
				resolved[key] = parsedParams[key];
			} else if (Object.hasOwn(entry, 'default')) {
				resolved[key] = structuredClone(entry.default);
			}
		}

		return resolved;
	}

	public validateParams(schema: MrfLuaParamsSchema, params: MrfLuaParams = {}): MrfLuaParams {
		const parsedParams: MrfLuaParams = {};
		for (const key of Object.keys(params)) {
			if (!Object.hasOwn(schema, key)) {
				throw new Error(`unknown policy parameter: ${key}`);
			}
			parsedParams[key] = this.parseParamValue(key, schema[key], params[key]);
		}
		return parsedParams;
	}

	public filterCompatibleParams(schema: MrfLuaParamsSchema, params: MrfLuaParams = {}): MrfLuaParams {
		const filtered: MrfLuaParams = {};
		for (const [key, value] of Object.entries(params)) {
			const entry = schema[key];
			if (entry == null) continue;
			try {
				filtered[key] = this.parseParamValue(key, entry, value);
			} catch {
				// Drop stale values when a custom policy source changes its schema.
			}
		}
		return filtered;
	}

	private createMrfApi() {
		return {
			accept: (reason?: string) => ({
				action: 'accept',
				...(typeof reason === 'string' ? { reason } : {}),
			}),
			reject: (reason: string) => ({
				action: 'reject',
				reason,
			}),
			rewrite: (activity: IActivity, reason?: string) => ({
				action: 'rewrite',
				activity,
				...(typeof reason === 'string' ? { reason } : {}),
			}),
		};
	}

	private async runString(lua: Awaited<ReturnType<LuaFactory['createEngine']>>, source: string, name: string, timeoutMs: number): Promise<void> {
		const thread = lua.global.newThread();
		thread.loadString(source, name);
		await thread.run(0, { timeout: timeoutMs });
	}

	private parseParamsSchema(value: unknown): MrfLuaParamsSchema {
		if (!isRecord(value)) {
			throw new Error('policy.params must be an object');
		}

		const schema: MrfLuaParamsSchema = {};
		for (const [key, entry] of Object.entries(value)) {
			if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key)) {
				throw new Error(`invalid policy parameter name: ${key}`);
			}
			if (!isRecord(entry)) {
				throw new Error(`policy parameter ${key} must be an object`);
			}
			if (!isParamType(entry.type)) {
				throw new Error(`policy parameter ${key} has unsupported type: ${String(entry.type)}`);
			}

			const parsed: MrfLuaParamSchemaEntry = {
				type: entry.type,
			};
			if (Object.hasOwn(entry, 'default')) {
				parsed.default = this.parseParamValue(key, parsed, entry.default) as MrfLuaParamSchemaEntry['default'];
			}
			if (entry.label !== undefined) {
				if (typeof entry.label !== 'string' || entry.label.length > 128) {
					throw new Error(`policy parameter ${key} label must be a string`);
				}
				parsed.label = entry.label;
			}
			if (entry.description !== undefined) {
				if (typeof entry.description !== 'string' || entry.description.length > 512) {
					throw new Error(`policy parameter ${key} description must be a string`);
				}
				parsed.description = entry.description;
			}

			schema[key] = parsed;
		}

		return schema;
	}

	private parseParamValue(key: string, entry: MrfLuaParamSchemaEntry, value: unknown): unknown {
		switch (entry.type) {
			case 'string':
				if (typeof value !== 'string') throw new Error(`policy parameter ${key} must be a string`);
				return value;
			case 'boolean':
				if (typeof value !== 'boolean') throw new Error(`policy parameter ${key} must be a boolean`);
				return value;
			case 'number':
				if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`policy parameter ${key} must be a finite number`);
				return value;
			case 'integer':
				if (typeof value !== 'number' || !Number.isInteger(value)) throw new Error(`policy parameter ${key} must be an integer`);
				return value;
			case 'string_array':
				if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
					throw new Error(`policy parameter ${key} must be an array of strings`);
				}
				return [...value];
		}
	}

	private parseDecision(value: unknown, originalActivity: IActivity): MrfLuaDecision {
		if (!isRecord(value)) {
			throw new Error('policy returned a non-object decision');
		}

		if (value.action === 'accept') {
			return {
				action: 'accept',
				...(typeof value.reason === 'string' ? { reason: value.reason } : {}),
			};
		}

		if (value.action === 'reject') {
			if (typeof value.reason !== 'string' || value.reason.length === 0) {
				throw new Error('reject decision must include a reason');
			}

			return {
				action: 'reject',
				reason: value.reason,
			};
		}

		if (value.action === 'rewrite') {
			if (!isRecord(value.activity)) {
				throw new Error('rewrite decision must include an activity');
			}

			return {
				action: 'rewrite',
				activity: this.normalizeLuaArrayShapes(value.activity, originalActivity) as unknown as IActivity,
				...(typeof value.reason === 'string' ? { reason: value.reason } : {}),
			};
		}

		throw new Error(`unknown policy action: ${String(value.action)}`);
	}

	private normalizeLuaArrayShapes(value: unknown, template: unknown): unknown {
		if (Array.isArray(template) && isRecord(value) && Object.keys(value).length === 0) {
			return [];
		}

		if (Array.isArray(value)) {
			const templateArray = Array.isArray(template) ? template : [];
			return value.map((item, index) => this.normalizeLuaArrayShapes(item, templateArray[index]));
		}

		if (!isRecord(value) || !isRecord(template)) {
			return value;
		}

		for (const [key, item] of Object.entries(value)) {
			value[key] = this.normalizeLuaArrayShapes(item, template[key]);
		}

		return value;
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isParamType(value: unknown): value is MrfLuaParamType {
	return value === 'string' || value === 'boolean' || value === 'number' || value === 'integer' || value === 'string_array';
}

function renderLuaError(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}

	return String(error);
}
