/*
 * SPDX-FileCopyrightText: Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { MiDriveFile } from '@/models/DriveFile.js';
import { MiUser } from '@/models/User.js';
import { id } from './util/id.js';

@Entity('emoji_suggestion')
export class MiEmojiSuggestion {
	@PrimaryColumn(id())
	public id: string;

	@Index('IDX_emoji_suggestion_user')
	@Column(id())
	public userId: MiUser['id'];

	@ManyToOne(() => MiUser, {
		onDelete: 'CASCADE',
	})
	@JoinColumn()
	public user: MiUser;

	@Index('IDX_emoji_suggestion_file', { unique: true })
	@Column(id())
	public fileId: MiDriveFile['id'];

	@ManyToOne(() => MiDriveFile, {
		onDelete: 'CASCADE',
	})
	@JoinColumn()
	public file: MiDriveFile;

	@Index('IDX_emoji_suggestion_name', { unique: true })
	@Column('varchar', {
		length: 128,
	})
	public name: string;

	@Column('varchar', {
		length: 128,
		nullable: true,
	})
	public category: string | null;

	@Column('varchar', {
		array: true,
		length: 128,
		default: '{}',
	})
	public aliases: string[];

	@Column('varchar', {
		length: 1024,
		nullable: true,
	})
	public license: string | null;

	@Column('boolean', {
		default: false,
	})
	public localOnly: boolean;

	@Column('boolean', {
		default: false,
	})
	public isSensitive: boolean;
}
