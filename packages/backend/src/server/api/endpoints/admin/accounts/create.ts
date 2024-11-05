/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { MiAccessToken, MiUser } from '@/models/_.js';
import { SignupService } from '@/core/SignupService.js';
import { UserEntityService } from '@/core/entities/UserEntityService.js';
import { InstanceActorService } from '@/core/InstanceActorService.js';
import { localUsernameSchema, passwordSchema } from '@/models/User.js';
import { Packed } from '@/misc/json-schema.js';
import { RoleService } from '@/core/RoleService.js';
import { ApiError } from '@/server/api/error.js';

export const meta = {
	tags: ['admin'],

	res: {
		type: 'object',
		optional: false, nullable: false,
		ref: 'MeDetailed',
		properties: {
			token: {
				type: 'string',
				optional: false, nullable: false,
			},
		},
	},

	errors: {
		// From ApiCallService.ts
		noCredential: {
			message: 'Credential required.',
			code: 'CREDENTIAL_REQUIRED',
			id: '1384574d-a912-4b81-8601-c7b1c4085df1',
			httpStatusCode: 401,
		},
		noAdmin: {
			message: 'You are not assigned to an administrator role.',
			code: 'ROLE_PERMISSION_DENIED',
			kind: 'permission',
			id: 'c3d38592-54c0-429d-be96-5636b0431a61',
		},
		noPermission: {
			message: 'Your app does not have the necessary permissions to use this endpoint.',
			code: 'PERMISSION_DENIED',
			kind: 'permission',
			id: '1370e5b7-d4eb-4566-bb1d-7748ee6a1838',
		},
	},

	// Required token permissions, but we need to check them manually.
	// ApiCallService checks access in a way that would prevent creating the first account.
	softPermissions: [
		'write:admin:account',
		'write:admin:approve-user',
	],
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		username: localUsernameSchema,
		password: passwordSchema,
	},
	required: ['username', 'password'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		private roleService: RoleService,
		private userEntityService: UserEntityService,
		private signupService: SignupService,
		private instanceActorService: InstanceActorService,
	) {
		super(meta, paramDef, async (ps, _me, token) => {
			await this.ensurePermissions(_me, token);

			const { account, secret } = await this.signupService.signup({
				username: ps.username,
				password: ps.password,
				ignorePreservedUsernames: true,
				approved: true,
			});

			const res = await this.userEntityService.pack(account, account, {
				schema: 'MeDetailed',
				includeSecrets: true,
			}) as Packed<'MeDetailed'> & { token: string };

			res.token = secret;

			return res;
		});
	}

	private async ensurePermissions(me: MiUser | null, token: MiAccessToken | null): Promise<void> {
		// Tokens have scoped permissions which may be *less* than the user's official role, so we need to check.
		if (token && !meta.softPermissions.every(p => token.permission.includes(p))) {
			throw new ApiError(meta.errors.noPermission);
		}

		// Only administrators (including root) can create users.
		if (me && !await this.roleService.isAdministrator(me)) {
			throw new ApiError(meta.errors.noAdmin);
		}

		// Anonymous access is only allowed for initial instance setup.
		if (!me && await this.instanceActorService.realLocalUsersPresent()) {
			throw new ApiError(meta.errors.noCredential);
		}
	}
}
