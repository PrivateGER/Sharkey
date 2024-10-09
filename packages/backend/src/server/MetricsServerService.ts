import { Inject, Injectable } from '@nestjs/common';
import {
	AggregatorRegistry,
	collectDefaultMetrics,
} from 'prom-client';
import { bindThis } from '@/decorators.js';
import type { FastifyInstance, FastifyPluginOptions } from 'fastify';

@Injectable()
export class MetricsServerService {
	private register: AggregatorRegistry;

	constructor(
	) {
		this.register = new AggregatorRegistry()
		collectDefaultMetrics({
			register: this.register,
		});
	}

	@bindThis
	public createServer(fastify: FastifyInstance, options: FastifyPluginOptions, done: (err?: Error) => void) {
		fastify.get('/', async (request, reply) => {
			reply
				.code(200)
				.type(this.register.contentType)
				.send(
					await this.register.clusterMetrics(),
				);
		});
		done();
	}
}
