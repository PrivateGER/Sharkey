/*
 * SPDX-FileCopyrightText: hazelnoot and other Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Column, PrimaryColumn, Entity } from 'typeorm';

@Entity('ap_context')
export class SkApContext {
	@PrimaryColumn('text', {
		primaryKeyConstraintName: 'PK_ap_context',
	})
	public md5: string;

	@Column('jsonb')
	// https://github.com/typeorm/typeorm/issues/8559
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	public json: any;

	constructor(data?: Partial<SkApContext>) {
		if (data) {
			Object.assign(this, data);
		}
	}
}
