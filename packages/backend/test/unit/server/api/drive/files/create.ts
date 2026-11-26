/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import sharp from 'sharp';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { randomString } from '../../../../../utils.js';
import { CoreModule } from '@/core/CoreModule.js';
import { RoleService } from '@/core/RoleService.js';
import { DI } from '@/di-symbols.js';
import { GlobalModule } from '@/GlobalModule.js';
import { DriveFilesRepository, DriveFoldersRepository, MiDriveFolder, MiRole, UserProfilesRepository, UsersRepository } from '@/models/_.js';
import { MiUser } from '@/models/User.js';
import { ServerModule } from '@/server/ServerModule.js';
import { ServerService } from '@/server/ServerService.js';
import { IdService } from '@/core/IdService.js';
import { InternalStorageService } from '@/core/InternalStorageService.js';

describe('/drive/files/create', () => {
	let module: TestingModule;
	let server: InstanceType<typeof ServerService>['fastify'];
	let roleService: RoleService;
	let idService: IdService;

	let root: MiUser;
	let role_tinyAttachment: MiRole;

	let folder: MiDriveFolder;

	beforeAll(async () => {
		module = await Test.createTestingModule({
			imports: [GlobalModule, CoreModule, ServerModule],
		}).compile();

		await module.init();
		module.enableShutdownHooks();

		const serverService = module.get<ServerService>(ServerService);
		await serverService.launch();
		server = serverService.fastify;

		idService = module.get(IdService);

		const usersRepository = module.get<UsersRepository>(DI.usersRepository);
		await usersRepository.deleteAll();
		root = await usersRepository.insert({
			id: idService.gen(),
			username: 'root',
			usernameLower: 'root',
			token: '1234567890123456',
		}).then(x => usersRepository.findOneByOrFail(x.identifiers[0]));

		const userProfilesRepository = module.get<UserProfilesRepository>(DI.userProfilesRepository);
		await userProfilesRepository.deleteAll();
		await userProfilesRepository.insert({
			userId: root.id,
		});

		const driveFoldersRepository = module.get<DriveFoldersRepository>(DI.driveFoldersRepository);
		folder = await driveFoldersRepository.insertOne({
			id: idService.gen(),
			name: 'root-folder',
			parentId: null,
			userId: root.id,
		});

		roleService = module.get<RoleService>(RoleService);
		role_tinyAttachment = await roleService.create({
			name: 'test-role001',
			description: 'Test role001 description',
			target: 'manual',
			policies: {
				maxFileSizeMb: {
					useDefault: false,
					priority: 1,
					// 10byte
					value: 10 / 1024 / 1024,
				},
			},
		});
	});

	beforeEach(async () => {
		await roleService.unassign(root.id, role_tinyAttachment.id).catch(() => {
		});
	});

	afterAll(async () => {
		await server.close();
		await module.close();
	});

	async function postFile(props: {
		name: string,
		comment: string,
		isSensitive: boolean,
		force: boolean,
		fileContent: Buffer | string,
	}) {
		const { name, comment, isSensitive, force, fileContent } = props;

		return await request(server.server)
			.post('/api/drive/files/create')
			.set('Content-Type', 'multipart/form-data')
			.attach('file', fileContent)
			.field('name', name)
			.field('comment', comment)
			.field('isSensitive', isSensitive)
			.field('force', force)
			.field('folderId', folder.id)
			.field('i', root.token ?? '');
	}

	test('200 ok', async () => {
		const name = randomString();
		const comment = randomString();
		const result = await postFile({
			name: name,
			comment: comment,
			isSensitive: true,
			force: true,
			fileContent: Buffer.from('a'.repeat(1000 * 1000)),
		});
		expect(result.statusCode).toBe(200);
		expect(result.body.name).toBe(name + '.unknown');
		expect(result.body.comment).toBe(comment);
		expect(result.body.isSensitive).toBe(true);
		expect(result.body.folderId).toBe(folder.id);
	});

	test('200 ok(with role)', async () => {
		await roleService.assign(root.id, role_tinyAttachment.id);

		const name = randomString();
		const comment = randomString();
		const result = await postFile({
			name: name,
			comment: comment,
			isSensitive: true,
			force: true,
			fileContent: Buffer.from('a'.repeat(10)),
		});
		expect(result.statusCode).toBe(200);
		expect(result.body.name).toBe(name + '.unknown');
		expect(result.body.comment).toBe(comment);
		expect(result.body.isSensitive).toBe(true);
		expect(result.body.folderId).toBe(folder.id);
	});

	test('413 too large', async () => {
		await roleService.assign(root.id, role_tinyAttachment.id);

		const name = randomString();
		const comment = randomString();
		const result = await postFile({
			name: name,
			comment: comment,
			isSensitive: true,
			force: true,
			fileContent: Buffer.from('a'.repeat(11)),
		});
		expect(result.statusCode).toBe(413);
		expect(result.body.error.code).toBe('MAX_FILE_SIZE_EXCEEDED');
	});

	test('stores uploaded photos without location or camera details', async () => {
		const photo = await sharp({ create: { width: 64, height: 48, channels: 3, background: '#3a7' } })
			.withExif({
				IFD0: { Make: 'TestPhone', Model: 'GPSCam' },
				IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '35/1 41/1 22/1', GPSLongitudeRef: 'E', GPSLongitude: '139/1 41/1 30/1' },
			})
			.jpeg()
			.toBuffer();
		const tagsOf = (bytes: Buffer): string[] => Object.keys(JSON.parse(execFileSync('exiftool', ['-j', '-s', '-a', '-'], { input: bytes }).toString())[0]);
		expect(tagsOf(photo)).toEqual(expect.arrayContaining(['GPSLatitude', 'Make']));

		const result = await postFile({
			name: randomString(),
			comment: randomString(),
			isSensitive: false,
			force: true,
			fileContent: photo,
		});
		expect(result.statusCode).toBe(200);

		const file = await module.get<DriveFilesRepository>(DI.driveFilesRepository).findOneByOrFail({ id: result.body.id });
		const stored = await fs.readFile(module.get(InternalStorageService).resolvePath(file.accessKey!));
		const storedTags = tagsOf(stored);
		expect(storedTags.filter(t => t.startsWith('GPS'))).toEqual([]);
		expect(storedTags).not.toContain('Make');
		expect(storedTags).not.toContain('Model');
		expect(file.md5).toBe(createHash('md5').update(stored).digest('hex'));
		expect(file.size).toBe(stored.length);
	});

	test('422 when metadata cannot be removed', async () => {
		const photo = await sharp({ create: { width: 320, height: 240, channels: 3, background: '#3a7' } }).jpeg().toBuffer();

		const result = await postFile({
			name: randomString(),
			comment: randomString(),
			isSensitive: false,
			force: true,
			// Still detected as JPEG, but cut off before the image ends
			fileContent: photo.subarray(0, 300),
		});
		expect(result.statusCode).toBe(422);
		expect(result.body.error.code).toBe('METADATA_REMOVAL_FAILED');
	});
});
