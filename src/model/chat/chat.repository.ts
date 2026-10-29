// import {
//   ConflictException,
//   Injectable,
//   NotFoundException,
// } from '@nestjs/common';
// import { randomUUID } from 'node:crypto';
// import { PrismaService } from '../../common/prisma/prisma.service';
// import { Prisma } from '../../generated/prisma/client';
// import type { ChatState } from './chat.interface';
// import { CHAT_MODES, type ChatMode } from './chat-mode';

// interface SaveChat {
//   userId: string;
//   documentIds: string[];
//   question: string;
//   existingSessionId?: string;
//   sessionId: string;
//   parent: string | null;
//   result: ChatState;
// }

// @Injectable()
// export class ChatRepository {
//   constructor(private readonly prisma: PrismaService) {}

//   async prepare(
//     userId: string,
//     ids: string[],
//     existingSessionId?: string,
//     mode: ChatMode = 'ultra',
//   ) {
//     const policy = CHAT_MODES[mode];

//     const docs = await this.prisma.document.findMany({
//       where: {
//         id: { in: ids },
//         userId,
//         deletedAt: null,
//       },
//       select: {
//         id: true,
//         status: true,
//       },
//     });

//     if (docs.length !== ids.length)
//       throw new NotFoundException('Document not found');

//     if (docs.some((d) => d.status !== 'READY'))
//       throw new ConflictException(
//         'All documents must be ready before chatting',
//       );

//     const sid = existingSessionId ?? randomUUID();

//     let parent: string | null = null;

//     if (existingSessionId) {
//       const session = await this.prisma.chatSession.findFirst({
//         where: {
//           id: sid,
//           userId,
//           deletedAt: null,
//         },
//       });

//       if (!session) throw new NotFoundException('Conversation not found');

//       parent = session.activeLeafMessageId;
//     }

//     const history = parent
//       ? await this.prisma.$queryRaw<
//           ChatState['history']
//         >`
//         WITH RECURSIVE
//           branch AS (
//             SELECT
//               id,
//               parent_message_id,
//               role,
//               left(content, ${policy.historyCharacters}) AS content,
//               1 AS depth,
//               length(left(content, ${policy.historyCharacters})) AS characters
//             FROM
//               chat_history
//             WHERE
//               id = ${parent}::uuid
//               AND session_id = ${sid}::uuid
//               AND deleted_at IS NULL
//             UNION ALL
//             SELECT
//               h.id,
//               h.parent_message_id,
//               h.role,
//               left(
//                 h.content,
//                 least(
//                   ${policy.historyCharacters},
//                   ${policy.historyBudget} - b.characters
//                 )
//               ),
//               b.depth + 1,
//               b.characters + length(
//                 left(
//                   h.content,
//                   least(
//                     ${policy.historyCharacters},
//                     ${policy.historyBudget} - b.characters
//                   )
//                 )
//               )
//             FROM
//               chat_history h
//               JOIN branch b ON h.id = b.parent_message_id
//             WHERE
//               h.session_id = ${sid}::uuid
//               AND h.deleted_at IS NULL
//               AND b.depth < ${policy.historyMessages}
//               AND b.characters < ${policy.historyBudget}
//           )
//         SELECT
//           role,
//           content
//         FROM
//           branch
//         ORDER BY
//           depth DESC
//       `
//       : [];

//     return {
//       sessionId: sid,
//       parent,
//       history,
//     };
//   }

//   async save({
//     userId, documentIds: ids, question, existingSessionId,
//     sessionId: sid, parent, result,
//   }: SaveChat) {
//     const userMessage = randomUUID(),
//       assistantMessage = randomUUID();

//     await this.prisma.$transaction(async (tx) => {
//       const available = await tx.$queryRaw<
//         { id: string }[]
//       >`
//         SELECT
//           id
//         FROM
//           documents
//         WHERE
//           id IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))})
//           AND user_id = ${userId}::uuid
//           AND deleted_at IS NULL
//           AND status = 'ready'
//         FOR SHARE
//       `;

//       if (available.length !== ids.length)
//         throw new ConflictException('Document availability changed; try again');

//       if (existingSessionId) {
//         const current = await tx.$queryRaw<
//           { active_leaf_message_id: string | null }[]
//         >`
//           SELECT
//             active_leaf_message_id
//           FROM
//             chat_session
//           WHERE
//             id = ${sid}::uuid
//             AND user_id = ${userId}::uuid
//             AND deleted_at IS NULL
//           FOR UPDATE
//         `;

//         if (!current.length)
//           throw new NotFoundException('Conversation not found');

//         if (current[0].active_leaf_message_id !== parent)
//           throw new ConflictException(
//             'Conversation changed; retry your question',
//           );
//       } else
//         await tx.chatSession.create({
//           data: {
//             id: sid,
//             userId,
//             title: question.slice(0, 255),
//           },
//         });

//       await tx.sessionDocument.createMany({
//         data: ids.map((documentId) => ({
//           sessionId: sid,
//           documentId,
//         })),
//         skipDuplicates: true,
//       });

//       await tx.chatHistory.create({
//         data: {
//           id: userMessage,
//           sessionId: sid,
//           parentMessageId: parent,
//           versionGroupId: userMessage,
//           role: 'user',
//           content: question,
//           status: 'completed',
//           answerMode: 'document_only',
//           sources: [],
//         },
//       });

//       await tx.chatHistory.create({
//         data: {
//           id: assistantMessage,
//           sessionId: sid,
//           parentMessageId: userMessage,
//           versionGroupId: assistantMessage,
//           role: 'assistant',
//           content: result.answer,
//           status: 'completed',
//           answerMode: 'document_only',
//           sources: result.sources as unknown as Prisma.InputJsonValue,
//         },
//       });

//       await tx.chatSession.update({
//         where: { id: sid },
//         data: {
//           activeLeafMessageId: assistantMessage,
//           lastMessageAt: new Date(),
//           updatedAt: new Date(),
//         },
//       });
//     });

//     return assistantMessage;
//   }
// }
