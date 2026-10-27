import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataType, ConsistencyLevelEnum } from '@zilliz/milvus2-sdk-node';
import { MilvusService } from '../../common/milvus/milvus.service';
import { AiService } from '../../common/ai/ai.service';
import type { Chunk } from './documents.interface';

@Injectable()
export class VectorService {
  constructor(
    private readonly milvus: MilvusService,
    private readonly config: ConfigService,
    private readonly ai: AiService,
  ) {}

  get collection(): string {
    return this.config.get('MILVUS_COLLECTION', 'pdf_chunks_gemini_v1');
  }

  private check(status: { error_code?: string | number;
    reason?: string; }) {
    if (
      status.error_code !== undefined
      && status.error_code !== 'Success'
      && status.error_code !== 0
      && status.error_code !== '0'
    ) {
      throw new Error('Milvus operation failed');
    }
  }

  async ensureCollection() {
    const exists = await this.milvus.hasCollection({
      collection_name: this.collection,
    });

    this.check(exists.status);
    if (!exists.value) {
      const fields = [
        {
          name: 'id',
          data_type: DataType.VarChar,
          is_primary_key: true,
          max_length: 100,
        },
        {
          name: 'user_id',
          data_type: DataType.VarChar,
          max_length: 36,
        },
        {
          name: 'document_id',
          data_type: DataType.VarChar,
          max_length: 36,
        },
        {
          name: 'filename',
          data_type: DataType.VarChar,
          max_length: 1024,
        },
        {
          name: 'page',
          data_type: DataType.Int64,
        },
        {
          name: 'text',
          data_type: DataType.VarChar,
          max_length: 16000,
        },
        {
          name: 'vector',
          data_type: DataType.FloatVector,
          dim: Number(this.config.get('EMBEDDING_DIMENSIONS', '1536')),
        },
      ];

      this.check(
        await this.milvus.createCollection({
          collection_name: this.collection,
          fields,
          enable_dynamic_field: false,
        }),
      );
      this.check(
        await this.milvus.createIndex({
          collection_name: this.collection,
          field_name: 'vector',
          index_type: 'AUTOINDEX',
          metric_type: 'COSINE',
        }),
      );
    }
    this.check(
      await this.milvus.loadCollectionSync({
        collection_name: this.collection,
      }),
    );
  }

  async upsert(chunks: Chunk[]) {
    const vectors = await this.ai
      .embeddings()
      .embedDocuments(chunks.map((c) => c.text));

    if (vectors.length !== chunks.length)
      throw new Error('Embedding result count mismatch');
    this.validateVectors(vectors);

    const result = await this.milvus.upsert({
      collection_name: this.collection,
      data: chunks.map((chunk, i) => ({
        ...chunk,
        vector: vectors[i],
      })),
    });

    this.check(result.status);
  }

  async flush() {
    const result = await this.milvus.flushSync({
      collection_names: [this.collection],
    });

    this.check(result.status);
  }

  async search(
    userId: string,
    documentIds: string[],
    query: string,
  ): Promise<Chunk[]> {
    const vector = await this.ai
      .embeddings()
      .embedQuery(query);

    this.validateVectors([vector]);

    const result = await this.milvus.search({
      collection_name: this.collection,
      data: vector,
      anns_field: 'vector',
      limit: 6,
      metric_type: 'COSINE',
      filter: `user_id == ${JSON.stringify(userId)} and document_id in ${JSON.stringify(documentIds)}`,
      output_fields: [
        'user_id',
        'document_id',
        'filename',
        'page',
        'text',
      ],
      consistency_level: ConsistencyLevelEnum.Strong,
    });

    this.check(result.status);

    return result.results.map((hit) => ({
      id: String(hit.id),
      user_id: String(hit.user_id),
      document_id: String(hit.document_id),
      filename: String(hit.filename),
      page: Number(hit.page),
      text: String(hit.text),
    }));
  }

  private validateVectors(vectors: number[][]) {
    const dimensions = Number(this.config.get('EMBEDDING_DIMENSIONS', '1536'));

    if (
      vectors.some(
        (v) => v.length !== dimensions || v.some((n) => !Number.isFinite(n)),
      )
    ) {
      throw new Error('Provider returned invalid embeddings');
    }
  }
}
