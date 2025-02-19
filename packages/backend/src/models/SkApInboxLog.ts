/*
 * SPDX-FileCopyrightText: hazelnoot and other Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { SkApContext } from '@/models/SkApContext.js';
import { MiUser } from '@/models/_.js';
import { id } from './util/id.js';

/**
 * Records activities received in the inbox
 */
@Entity('ap_inbox_log')
export class SkApInboxLog {
	@PrimaryColumn({
		...id(),
		primaryKeyConstraintName: 'PK_ap_inbox_log',
	})
	public id: string;

	@Index('IDX_ap_inbox_log_at')
	@Column('timestamptz')
	public at: Date;

	/**
	 * Processing duration in milliseconds
	 */
	@Column('double precision', { nullable: true })
	public duration: number | null = null;

	/**
	 * Key ID that was used to sign this request.
	 * Untrusted unless verified is true.
	 */
	@Column({
		type: 'text',
		name: 'key_id',
	})
	public keyId: string;

	/**
	 * Instance that the activity was sent from.
	 * Untrusted unless verified is true.
	 */
	@Index('IDX_ap_inbox_log_host')
	@Column('text')
	public host: string;

	@Column('boolean')
	public verified: boolean;

	@Column('boolean')
	public accepted: boolean;

	@Column('text', { nullable: true })
	public result: string | null = null;

	@Column('jsonb')
	// https://github.com/typeorm/typeorm/issues/8559
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	public activity: any;

	@Column({
		type: 'text',
		name: 'context_hash',
		nullable: true,
	})
	public contextHash: string | null;

	@ManyToOne(() => SkApContext, {
		onDelete: 'CASCADE',
		nullable: true,
	})
	@JoinColumn({
		name: 'context_hash',
		foreignKeyConstraintName: 'FK_ap_inbox_log_context_hash',
	})
	public context: SkApContext | null;

	/**
	 * ID of the user who signed this request.
	 */
	@Column({
		...id(),
		name: 'auth_user_id',
		nullable: true,
	})
	public authUserId: string | null;

	/**
	 * User who signed this request.
	 */
	@ManyToOne(() => MiUser, {
		onDelete: 'CASCADE',
		nullable: true,
	})
	@JoinColumn({
		name: 'auth_user_id',
		foreignKeyConstraintName: 'FK_ap_inbox_log_auth_user_id',
	})
	public authUser: MiUser | null;

	constructor(data?: Partial<SkApInboxLog>) {
		if (data) {
			Object.assign(this, data);
		}
	}
}
