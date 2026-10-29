// import {
//   citedSources,
//   compactEvidence,
//   CHAT_MODES,
// } from './chat-mode';
// import type {
//   ChatEngine,
//   ChatProgress,
//   ChatState,
// } from './chat.interface';
// import type { Chunk } from '../documents/documents.interface';

// // Quick/pro deliberately use a linear pipeline, without graph evaluation or search loops.
// export async function runDirectChat(
//   state: ChatState,
//   mode: 'quick' | 'pro',
//   model: ChatEngine,
//   retrieve: (userId: string, ids: string[], query: string, limit: number) => Promise<Chunk[]>,
//   report: (progress: ChatProgress) => void,
//   signal: AbortSignal,
// ): Promise<ChatState> {
//   let question = state.question;

//   signal.throwIfAborted();

//   if (mode === 'pro' && state.history.length) {
//     question = (await model.rewrite(
//       state.question,
//       state.history,
//       signal,
//     ))
//       .trim()
//       .slice(
//         0,
//         8000,
//       )
//       || state.question;
//   }

//   // Resolve short follow-ups without spending another model call in quick mode.
//   const previousQuestion = mode === 'quick'
//     ? state.history
//       .filter((message) => message.role === 'user')
//       .at(-1)?.content
//     : undefined;

//   const query = previousQuestion
//     ? `${question.slice(0, 1400)}\nPrevious question: ${previousQuestion.slice(
//       0,
//       500,
//     )}`
//     : question.slice(0, 2000);

//   signal.throwIfAborted();
//   report(
//     {
//       stage: 'searching',
//       message: 'Mencari informasi di dokumen.',
//       attempt: 1,
//     },
//   );

//   const chunks = compactEvidence(
//     await retrieve(
//       state.userId,
//       state.documentIds,
//       query,
//       CHAT_MODES[mode].chunks,
//     ),
//     mode,
//   );

//   signal.throwIfAborted();
//   report({
//     stage: 'answering',
//     message: 'Menyusun jawaban dan sumber.',
//   });

//   const result = {
//     ...state,
//     standaloneQuestion: question,
//     query,
//     chunks,
//     attempts: 1,
//     enough: false,
//   };

//   if (!chunks.length) return {
//     ...result,
//     answer: 'Informasi yang relevan belum ditemukan di dokumen.',
//     sources: [],
//   };

//   const answer = await model.answer(
//     question,
//     chunks,
//     null,
//     signal,
//     {
//       history: state.history,
//       compact: mode === 'quick',
//     },
//   );

//   signal.throwIfAborted();

//   return {
//     ...result,
//     answer: answer.answer,
//     sources: citedSources(
//       chunks,
//       answer.source_ids,
//     ),
//   };
// }
