// import {
//   Annotation,
//   END,
//   START,
//   StateGraph,
// } from '@langchain/langgraph';
// import type { ChatState, ChatEngine } from './chat.interface';
// import type { Chunk } from '../documents/documents.interface';
// import { citedSources } from './chat-mode';

// const State = Annotation.Root({
//   question: Annotation<string>(),
//   standaloneQuestion: Annotation<string>(),
//   query: Annotation<string>(),
//   userId: Annotation<string>(),
//   documentIds: Annotation<string[]>(),
//   history: Annotation<ChatState['history']>(),
//   chunks: Annotation<Chunk[]>(),
//   attempts: Annotation<number>(),
//   enough: Annotation<boolean>(),
//   answer: Annotation<string>(),
//   sources: Annotation<ChatState['sources']>(),
// });

// export function buildChatGraph(
//   engine: ChatEngine,
//   retrieve: (userId: string, ids: string[], query: string) => Promise<Chunk[]>,
// ) {
//   return new StateGraph(State)
//     .addNode(
//       'prepare',
//       async (s, config) => {
//         const question = s.history.length
//           ? (await engine.rewrite(
//               s.question,
//               s.history,
//               config.signal,
//             ))
//               .trim()
//               .slice(
//                 0,
//                 8000,
//               )
//           : s.question;

//         const standaloneQuestion = question || s.question;

//         return {
//           standaloneQuestion,
//           query: standaloneQuestion.slice(0, 2000),
//         };
//       },
//     )
//     .addNode(
//       'search',
//       async (s) => {
//         const found = await retrieve(
//           s.userId,
//           s.documentIds,
//           s.query,
//         );

//         const chunks = new Map(s.chunks.map((c) => [
//           c.id,
//           c,
//         ]));

//         for (const chunk of found) chunks.set(chunk.id, chunk);

//         return {
//           chunks: [...chunks.values()],
//           attempts: s.attempts + 1,
//         };
//       },
//     )
//     .addNode(
//       'evaluate',
//       async (s, config) => {
//         const result = await engine.evaluate(
//           s.standaloneQuestion,
//           s.chunks,
//           config.signal,
//         );

//         return {
//           enough: result.enough,
//           query: result.next_query.slice(0, 2000) || s.query,
//         };
//       },
//     )
//     .addNode(
//       'generate',
//       async (s, config) => {
//         if (!s.chunks.length)
//           return {
//             answer: 'Informasi yang relevan belum ditemukan di dokumen.',
//             sources: [],
//           };

//         const result = await engine.answer(
//           s.standaloneQuestion,
//           s.chunks,
//           s.enough,
//           config.signal,
//         );

//         const sources = citedSources(s.chunks, result.source_ids);

//         return {
//           answer: result.answer,
//           sources,
//         };
//       },
//     )
//     .addEdge(START, 'prepare')
//     .addEdge('prepare', 'search')
//     .addConditionalEdges(
//       'search',
//       (s) => s.chunks.length ? 'evaluate' : 'generate',
//       {
//         evaluate: 'evaluate',
//         generate: 'generate',
//       },
//     )
//     .addConditionalEdges(
//       'evaluate',
//       (s) => (s.enough || s.attempts >= 3 ? 'generate' : 'search'),
//       {
//         generate: 'generate',
//         search: 'search',
//       },
//     )
//     .addEdge('generate', END)
//     .compile();
// }
