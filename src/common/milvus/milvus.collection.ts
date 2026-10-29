import { DataType, MilvusClient } from '@zilliz/milvus2-sdk-node';

export async function initializeCollections(client: MilvusClient) {
  const collectionName = 'document_chunks';

  const exists = await client.hasCollection({
    collection_name: collectionName,
  });

  if (exists.value) return;

  await client.createCollection({
    collection_name: collectionName,
    schema: [
      {
        name: 'id',
        data_type: DataType.VarChar,
        is_primary_key: true,
        max_length: 36,
      },
      {
        name: 'document_id',
        data_type: DataType.VarChar,
        max_length: 36,
      },
      {
        name: 'user_id',
        data_type: DataType.VarChar,
        max_length: 36,
      },
      {
        name: 'chunk_index',
        data_type: DataType.Int64,
      },
      {
        name: 'page_number',
        data_type: DataType.Int64,
      },
      {
        name: 'content',
        data_type: DataType.VarChar,
        max_length: 65535,
      },
      {
        name: 'embedding',
        data_type: DataType.FloatVector,
        dim: 1536,
      },
      {
        name: 'metadata',
        data_type: DataType.JSON,
      },
    ],
    index_params: [
      {
        field_name: 'embedding',
        index_type: 'AUTOINDEX',
        metric_type: 'COSINE',
      },
    ],
  });
}
