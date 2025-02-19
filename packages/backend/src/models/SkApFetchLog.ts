/*
 * SPDX-FileCopyrightText: hazelnoot and other Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Column, Index, JoinColumn, ManyToOne, PrimaryColumn, Entity } from 'typeorm';
import { SkApContext } from '@/models/SkApContext.js';
import { id } from './util/id.js';

/**
 * Records objects fetched via AP
 */
@Entity('ap_fetch_log')
export class SkApFetchLog {
	@PrimaryColumn({
		...id(),
		primaryKeyConstraintName: 'PK_ap_fetch_log',
	})
	public id: string;

	@Index('IDX_ap_fetch_log_at')
	@Column('timestamptz')
	public at: Date;

	/**
	 * Processing duration in milliseconds
	 */
	@Column('double precision', { nullable: true })
	public duration: number | null = null;

	/**
	 * DB hostname extracted from responseUri, or requestUri if fetch is incomplete
	 */
	@Index('IDX_ap_fetch_log_host')
	@Column('text')
	public host: string;

	/**
	 * Original requested URI
	 */
	@Column('text', {
		name: 'request_uri',
	})
	public requestUri: string;

	/**
	 * Canonical URI / object ID, taken from the final payload
	 */
	@Column('text', {
		name: 'object_uri',
		nullable: true,
	})
	@Index('IDX_ap_fetch_log_object_uri')
	public objectUri: string | null = null;

	@Column('boolean', { nullable: true })
	public accepted: boolean | null = null;

	@Column('text', { nullable: true })
	public result: string | null = null;

	@Column('jsonb', { nullable: true })
	// https://github.com/typeorm/typeorm/issues/8559
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	public object: any | null = null;

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
		foreignKeyConstraintName: 'FK_ap_fetch_log_context_hash',
	})
	public context: SkApContext | null;

	constructor(data?: Partial<SkApFetchLog>) {
		if (data) {
			Object.assign(this, data);
		}
	}
}
