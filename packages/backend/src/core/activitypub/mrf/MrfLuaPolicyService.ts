/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { createHash } from 'node:crypto';
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

export type MrfLuaPolicyWarningCode =
	| 'persistent_global_defined'
	| 'persistent_global_modified';

export type MrfLuaPolicyWarning = {
	code: MrfLuaPolicyWarningCode;
	key: string;
	message: string;
};

export type MrfLuaRunResult = {
	policy: Pick<MrfLuaPolicy, 'id' | 'name'>;
	decision: MrfLuaDecision;
	durationMs: number;
	warnings: MrfLuaPolicyWarning[];
};

export type MrfLuaPolicyMetadata = {
	paramsSchema: MrfLuaParamsSchema;
	warnings: MrfLuaPolicyWarning[];
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
	maxPreparedEnginesPerPolicy: number;
	maxPreparedEngineUses: number;
};

const DEFAULT_OPTIONS = {
	defaultTimeoutMs: 50,
	defaultMemoryLimitBytes: 1024 * 1024 * 8,
	maxPreparedEnginesPerPolicy: 2,
	maxPreparedEngineUses: 1000,
} satisfies MrfLuaPolicyServiceOptions;

const EXPECTED_POLICY_GLOBALS = new Set(['filter', 'mrf', 'policy']);

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

const POLICY_ENVIRONMENT_SOURCE = `
	local __mrf_policy_env = {
		mrf = mrf,
	}
	__mrf_policy_env._G = __mrf_policy_env
	setmetatable(__mrf_policy_env, { __index = _G })
	rawset(_G, "__mrf_policy_env", __mrf_policy_env)
`;

export class MrfLuaPolicyError extends Error {
	constructor(policy: Pick<MrfLuaPolicy, 'id' | 'name'>, cause: unknown) {
		super(`policy ${policy.id} failed: ${renderLuaError(cause)}`);
		this.name = 'MrfLuaPolicyError';
	}
}

type LuaEngine = Awaited<ReturnType<LuaFactory['createEngine']>>;

type PreparedPolicyEngine = {
	key: string;
	lua: LuaEngine;
	loadSnapshot: Map<string, string>;
	loadWarnings: MrfLuaPolicyWarning[];
	lookup?: MrfLuaLookupApi;
	uses: number;
};

type PreparedPolicyEngineWaiter = {
	resolve: (engine: PreparedPolicyEngine) => void;
	reject: (error: unknown) => void;
};

type PreparedPolicyEnginePool = {
	key: string;
	policyId: string;
	policy: Pick<MrfLuaPolicy, 'id' | 'name' | 'source' | 'timeoutMs'>;
	timeoutMs: number;
	total: number;
	available: PreparedPolicyEngine[];
	waiters: PreparedPolicyEngineWaiter[];
	retired: boolean;
};

export class MrfLuaPolicyService {
	private readonly luaFactory = new LuaFactory();
	private readonly options: MrfLuaPolicyServiceOptions;
	private readonly preparedEnginePools = new Map<string, PreparedPolicyEnginePool>();

	constructor(options?: Partial<MrfLuaPolicyServiceOptions>) {
		const resolvedOptions = {
			...DEFAULT_OPTIONS,
			...options,
		};
		this.options = {
			...resolvedOptions,
			maxPreparedEnginesPerPolicy: normalizePositiveInteger(resolvedOptions.maxPreparedEnginesPerPolicy, DEFAULT_OPTIONS.maxPreparedEnginesPerPolicy),
			maxPreparedEngineUses: normalizePositiveInteger(resolvedOptions.maxPreparedEngineUses, DEFAULT_OPTIONS.maxPreparedEngineUses),
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

		let engine: PreparedPolicyEngine | undefined;
		let reusable = false;

		try {
			engine = await this.borrowPreparedPolicyEngine(policy, timeoutMs);
			engine.lookup = options.lookup;
			engine.uses += 1;
			engine.lua.global.set('ctx', clonedContext);

			const returns = await this.runThread(engine.lua, 'return __mrf_policy_env.filter(ctx)', policy.name, timeoutMs);
			const decision = this.parseDecision(returns[0], clonedContext.activity);
			let warnings = this.mergeWarnings([...engine.loadWarnings]);
			try {
				const runtimeSnapshot = await this.capturePolicyGlobalSnapshot(engine.lua, timeoutMs);
				const runtimeWarnings = this.createRuntimeWarnings(engine.loadSnapshot, runtimeSnapshot);
				warnings = this.mergeWarnings([
					...engine.loadWarnings,
					...runtimeWarnings,
				]);
				reusable = runtimeWarnings.length === 0;
			} catch {
				// The decision is already computed; a snapshot failure must not discard it.
				// Discard the engine instead, since we can no longer prove it is clean.
				reusable = false;
			}

			return {
				policy: {
					id: policy.id,
					name: policy.name,
				},
				decision,
				durationMs: performance.now() - start,
				warnings,
			};
		} catch (error) {
			throw new MrfLuaPolicyError(policy, error);
		} finally {
			if (engine != null) {
				this.releasePreparedPolicyEngine(engine, reusable);
			}
		}
	}

	public async extractParamsSchema(policy: Pick<MrfLuaPolicy, 'id' | 'name' | 'source' | 'timeoutMs'>): Promise<MrfLuaParamsSchema> {
		return (await this.extractPolicyMetadata(policy)).paramsSchema;
	}

	public async extractPolicyMetadata(policy: Pick<MrfLuaPolicy, 'id' | 'name' | 'source' | 'timeoutMs'>): Promise<MrfLuaPolicyMetadata> {
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
			const loadResult = await this.loadPolicySource(lua, policy.source, policy.name, timeoutMs);
			const filterType = (await this.runThread(lua, 'return type(rawget(rawget(_G, "__mrf_policy_env"), "filter"))', 'mrf policy filter check', timeoutMs))[0];
			if (filterType !== 'function') {
				throw new Error('policy source must define a global filter(ctx) function');
			}
			const rawPolicy = await this.getPolicyEnvValue(lua, 'policy', timeoutMs);

			if (!isRecord(rawPolicy) || rawPolicy.params == null) {
				return {
					paramsSchema: {},
					warnings: loadResult.warnings,
				};
			}

			return {
				paramsSchema: this.parseParamsSchema(rawPolicy.params),
				warnings: loadResult.warnings,
			};
		} catch (error) {
			throw new MrfLuaPolicyError(policy, error);
		} finally {
			lua.global.close();
		}
	}

	public retainPreparedPolicyEngines(policyIds: Iterable<string>): void {
		const retainedPolicyIds = new Set(policyIds);
		for (const pool of this.preparedEnginePools.values()) {
			if (retainedPolicyIds.has(pool.policyId)) continue;
			this.retirePreparedPolicyEnginePool(pool);
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

	private async runThread(lua: LuaEngine, source: string, name: string, timeoutMs: number): Promise<unknown[]> {
		// lua_newthread pushes the thread onto the parent stack; it MUST be removed
		// after use or the main state's stack overflows its allocation after ~50 runs
		// and corrupts the wasm heap. Mirrors wasmoon's own callByteCode() guard.
		const thread = lua.global.newThread();
		const threadIndex = lua.global.getTop();
		try {
			thread.loadString(source, name);
			return await thread.run(0, { timeout: timeoutMs });
		} finally {
			lua.global.remove(threadIndex);
		}
	}

	private async runString(lua: LuaEngine, source: string, name: string, timeoutMs: number): Promise<void> {
		await this.runThread(lua, source, name, timeoutMs);
	}

	private async borrowPreparedPolicyEngine(policy: MrfLuaPolicy, timeoutMs: number): Promise<PreparedPolicyEngine> {
		const key = this.getPreparedPolicyEngineKey(policy, timeoutMs);
		this.retireStalePreparedPolicyEngines(policy.id, key);

		let pool = this.preparedEnginePools.get(key);
		if (pool == null) {
			pool = {
				key,
				policyId: policy.id,
				policy: {
					id: policy.id,
					name: policy.name,
					source: policy.source,
					timeoutMs: policy.timeoutMs,
				},
				timeoutMs,
				total: 0,
				available: [],
				waiters: [],
				retired: false,
			};
			this.preparedEnginePools.set(key, pool);
		}

		const available = pool.available.pop();
		if (available != null) {
			return available;
		}

		if (pool.total < this.options.maxPreparedEnginesPerPolicy) {
			pool.total += 1;
			try {
				return await this.createPreparedPolicyEngine(pool);
			} catch (error) {
				pool.total = Math.max(0, pool.total - 1);
				this.deletePreparedPolicyEnginePoolIfIdle(pool);
				throw error;
			}
		}

		return await new Promise((resolve, reject) => {
			pool.waiters.push({ resolve, reject });
		});
	}

	private async createPreparedPolicyEngine(pool: PreparedPolicyEnginePool): Promise<PreparedPolicyEngine> {
		const lua = await this.luaFactory.createEngine({
			openStandardLibs: true,
			injectObjects: true,
			enableProxy: false,
			traceAllocations: true,
			functionTimeout: pool.timeoutMs,
		});
		const engine: PreparedPolicyEngine = {
			key: pool.key,
			lua,
			loadSnapshot: new Map(),
			loadWarnings: [],
			uses: 0,
		};

		try {
			const mrfApi = this.createMrfApi();
			lua.global.setMemoryMax(this.options.defaultMemoryLimitBytes);
			lua.global.set('__mrf_accept', mrfApi.accept);
			lua.global.set('__mrf_reject', mrfApi.reject);
			lua.global.set('__mrf_rewrite', mrfApi.rewrite);
			lua.global.set('__mrf_lookup_user_by_uri', async (uri: string) => await (engine.lookup?.userByUri?.(uri) ?? null));
			lua.global.set('__mrf_lookup_user_by_mention', async (mention: Record<string, unknown> | string) => await (engine.lookup?.userByMention?.(mention) ?? null));
			lua.global.set('__mrf_lookup_instance_by_host', async (host: string) => await (engine.lookup?.instanceByHost?.(host) ?? null));
			lua.global.set('__mrf_lookup_note_by_uri', async (uri: string) => await (engine.lookup?.noteByUri?.(uri) ?? null));
			lua.global.set('ctx', null);
			await lua.doString(SANDBOX_PRELUDE);
			const loadResult = await this.loadPolicySource(lua, pool.policy.source, pool.policy.name, pool.timeoutMs);
			engine.loadSnapshot = loadResult.snapshot;
			engine.loadWarnings = loadResult.warnings;
			return engine;
		} catch (error) {
			lua.global.close();
			throw error;
		}
	}

	private releasePreparedPolicyEngine(engine: PreparedPolicyEngine, reusable: boolean): void {
		const pool = this.preparedEnginePools.get(engine.key);
		engine.lookup = undefined;
		if (reusable) {
			try {
				engine.lua.global.set('ctx', null);
			} catch {
				reusable = false;
			}
		}

		if (pool == null || pool.retired || !reusable || engine.uses >= this.options.maxPreparedEngineUses) {
			this.closePreparedPolicyEngine(engine);
			if (pool != null) {
				pool.total = Math.max(0, pool.total - 1);
				this.startWaitingPreparedPolicyEngine(pool);
				this.deletePreparedPolicyEnginePoolIfIdle(pool);
			}
			return;
		}

		const waiter = pool.waiters.shift();
		if (waiter != null) {
			waiter.resolve(engine);
			return;
		}

		pool.available.push(engine);
	}

	private startWaitingPreparedPolicyEngine(pool: PreparedPolicyEnginePool): void {
		const waiter = pool.waiters.shift();
		if (waiter == null) return;
		if (pool.retired) {
			waiter.reject(new Error('policy engine pool was retired'));
			this.startWaitingPreparedPolicyEngine(pool);
			return;
		}

		pool.total += 1;
		void this.createPreparedPolicyEngine(pool)
			.then(waiter.resolve)
			.catch(error => {
				pool.total = Math.max(0, pool.total - 1);
				waiter.reject(error);
				this.startWaitingPreparedPolicyEngine(pool);
				this.deletePreparedPolicyEnginePoolIfIdle(pool);
			});
	}

	private retireStalePreparedPolicyEngines(policyId: string, currentKey: string): void {
		for (const pool of this.preparedEnginePools.values()) {
			if (pool.policyId !== policyId || pool.key === currentKey) continue;
			this.retirePreparedPolicyEnginePool(pool);
		}
	}

	private retirePreparedPolicyEnginePool(pool: PreparedPolicyEnginePool): void {
		pool.retired = true;
		this.preparedEnginePools.delete(pool.key);
		for (const engine of pool.available) {
			this.closePreparedPolicyEngine(engine);
			pool.total = Math.max(0, pool.total - 1);
		}
		pool.available = [];
		for (const waiter of pool.waiters) {
			waiter.reject(new Error('policy engine pool was retired'));
		}
		pool.waiters = [];
	}

	private deletePreparedPolicyEnginePoolIfIdle(pool: PreparedPolicyEnginePool): void {
		if (pool.total === 0 && pool.available.length === 0 && pool.waiters.length === 0 && this.preparedEnginePools.get(pool.key) === pool) {
			this.preparedEnginePools.delete(pool.key);
		}
	}

	private closePreparedPolicyEngine(engine: PreparedPolicyEngine): void {
		try {
			engine.lua.global.close();
		} catch {
			// Nothing useful can be done if an already-failed VM also fails to close.
		}
	}

	private getPreparedPolicyEngineKey(policy: MrfLuaPolicy, timeoutMs: number): string {
		const hash = createHash('sha256')
			.update(policy.id)
			.update('\0')
			.update(policy.name)
			.update('\0')
			.update(policy.source)
			.update('\0')
			.update(String(timeoutMs))
			.update('\0')
			.update(String(this.options.defaultMemoryLimitBytes))
			.digest('hex');
		return `${policy.id}:${hash}`;
	}

	private async loadPolicySource(lua: LuaEngine, source: string, name: string, timeoutMs: number): Promise<{ snapshot: Map<string, string>; warnings: MrfLuaPolicyWarning[] }> {
		await this.runString(lua, POLICY_ENVIRONMENT_SOURCE, 'mrf policy environment', timeoutMs);
		const baseline = await this.capturePolicyGlobalSnapshot(lua, timeoutMs);
		await this.runString(lua, this.wrapPolicySource(source), name, timeoutMs);
		const snapshot = await this.capturePolicyGlobalSnapshot(lua, timeoutMs);
		return {
			snapshot,
			warnings: this.createLoadWarnings(baseline, snapshot),
		};
	}

	private wrapPolicySource(source: string): string {
		return `
			local __mrf_policy_env = rawget(_G, "__mrf_policy_env")
			do
				local _ENV = __mrf_policy_env
${source}
			end
		`;
	}

	private async getPolicyEnvValue(lua: LuaEngine, key: string, timeoutMs: number): Promise<unknown> {
		const returns = await this.runThread(lua, `return rawget(rawget(_G, "__mrf_policy_env"), ${JSON.stringify(key)})`, 'mrf policy metadata', timeoutMs);
		return returns[0];
	}

	private async capturePolicyGlobalSnapshot(lua: LuaEngine, timeoutMs: number): Promise<Map<string, string>> {
		const returns = await this.runThread(lua, `
			local env = rawget(_G, "__mrf_policy_env")
			local result = {}
			if type(env) ~= "table" then
				return result
			end

			local seen = {}
			local function fingerprint(value, depth)
				local value_type = type(value)
				if value == nil then
					return "nil"
				end
				if value_type == "string" or value_type == "number" or value_type == "boolean" then
					return value_type .. ":" .. tostring(value)
				end
				if value_type ~= "table" then
					return value_type .. ":" .. tostring(value)
				end
				if seen[value] then
					return "table:<cycle>"
				end
				if depth >= 3 then
					return "table:<maxdepth>:" .. tostring(value)
				end

				seen[value] = true
				local entries = {}
				local count = 0
				for item_key, item_value in pairs(value) do
					count = count + 1
					if count > 64 then
						entries[#entries + 1] = "..."
						break
					end
					entries[#entries + 1] = fingerprint(item_key, depth + 1) .. "=" .. fingerprint(item_value, depth + 1)
				end
				table.sort(entries)
				seen[value] = nil
				return "table:{" .. table.concat(entries, ",") .. "}"
			end

			for key, value in pairs(env) do
				if type(key) == "string" and key ~= "_G" then
					result[#result + 1] = {
						key = key,
						fingerprint = fingerprint(value, 0),
					}
				end
			end

			return result
		`, 'mrf policy globals snapshot', timeoutMs);
		const entries = returns[0];
		const snapshot = new Map<string, string>();
		if (!Array.isArray(entries)) {
			return snapshot;
		}

		for (const entry of entries) {
			if (!isRecord(entry) || typeof entry.key !== 'string' || typeof entry.fingerprint !== 'string') continue;
			snapshot.set(entry.key, entry.fingerprint);
		}

		return new Map([...snapshot.entries()].sort(([left], [right]) => left.localeCompare(right)));
	}

	private createLoadWarnings(before: Map<string, string>, after: Map<string, string>): MrfLuaPolicyWarning[] {
		const keys = new Set([
			...before.keys(),
			...after.keys(),
		]);
		const warnings: MrfLuaPolicyWarning[] = [];
		for (const key of [...keys].sort((left, right) => left.localeCompare(right))) {
			if (!before.has(key)) {
				if (EXPECTED_POLICY_GLOBALS.has(key)) continue;
				warnings.push({
					code: 'persistent_global_defined',
					key,
					message: `Policy defines persistent global: ${key}`,
				});
				continue;
			}
			if (before.get(key) !== after.get(key)) {
				warnings.push({
					code: 'persistent_global_modified',
					key,
					message: `Policy modified persistent global while loading: ${key}`,
				});
			}
		}
		return warnings;
	}

	private createRuntimeWarnings(before: Map<string, string>, after: Map<string, string>): MrfLuaPolicyWarning[] {
		const keys = new Set([
			...before.keys(),
			...after.keys(),
		]);
		return [...keys]
			.sort((left, right) => left.localeCompare(right))
			.filter(key => before.get(key) !== after.get(key))
			.map(key => ({
				code: 'persistent_global_modified' as const,
				key,
				message: `Policy modified persistent global during execution: ${key}`,
			}));
	}

	private mergeWarnings(warnings: MrfLuaPolicyWarning[]): MrfLuaPolicyWarning[] {
		const merged = new Map<string, MrfLuaPolicyWarning>();
		for (const warning of warnings) {
			merged.set(`${warning.code}:${warning.key}:${warning.message}`, warning);
		}
		return [...merged.values()];
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

			const activity = this.normalizeLuaArrayShapes(value.activity, originalActivity) as unknown as IActivity;
			this.assertJsonSafe(activity, 'activity');
			return {
				action: 'rewrite',
				activity,
				...(typeof value.reason === 'string' ? { reason: value.reason } : {}),
			};
		}

		throw new Error(`unknown policy action: ${String(value.action)}`);
	}

	private assertJsonSafe(value: unknown, path: string, seen = new Set<object>()): void {
		if (value === null) return;
		switch (typeof value) {
			case 'string':
			case 'boolean':
				return;
			case 'number':
				if (!Number.isFinite(value)) {
					throw new Error(`rewrite activity contains a non-finite number at ${path}`);
				}
				return;
			case 'object':
				break;
			default:
				throw new Error(`rewrite activity contains a non-JSON value (${typeof value}) at ${path}`);
		}

		const obj = value as object;
		if (seen.has(obj)) {
			throw new Error(`rewrite activity contains a cyclic reference at ${path}`);
		}
		seen.add(obj);
		if (Array.isArray(obj)) {
			for (let i = 0; i < obj.length; i++) {
				this.assertJsonSafe(obj[i], `${path}[${i}]`, seen);
			}
		} else {
			const proto = Object.getPrototypeOf(obj);
			if (proto !== Object.prototype && proto !== null) {
				throw new Error(`rewrite activity contains a non-plain object at ${path}`);
			}
			for (const [key, item] of Object.entries(obj as Record<string, unknown>)) {
				if (item === undefined) continue;
				this.assertJsonSafe(item, `${path}.${key}`, seen);
			}
		}
		seen.delete(obj);
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

function normalizePositiveInteger(value: number, fallback: number): number {
	if (!Number.isFinite(value)) return fallback;
	return Math.max(1, Math.trunc(value));
}

function renderLuaError(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}

	return String(error);
}
