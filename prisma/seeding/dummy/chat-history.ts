export interface DummyConversation {
  question: string;
  answer: string;
}

export const dummyConversations: DummyConversation[] = [
  {
    question: 'Can you explain the main concept?',
    answer:
      'The main concept is about understanding the core principles and how they work together in practice.',
  },
  {
    question: 'Can you give me a practical example?',
    answer:
      'A practical example is building a small application that demonstrates the concept step by step.',
  },
  {
    question: 'What are the advantages?',
    answer:
      'The main advantages include better maintainability, scalability, and improved development efficiency.',
  },
  {
    question: 'Are there any disadvantages?',
    answer:
      'Yes. Some approaches introduce additional complexity, infrastructure requirements, and maintenance overhead.',
  },
  {
    question: 'How does this work internally?',
    answer:
      'Internally, the system processes input, applies the required logic, and produces an output based on predefined rules.',
  },
  {
    question: 'What are the best practices?',
    answer:
      'Best practices include separation of concerns, proper validation, error handling, and automated testing.',
  },
  {
    question: 'How can I implement this?',
    answer:
      'Start with a minimal implementation, validate the core functionality, and gradually introduce more advanced features.',
  },
  {
    question: 'What common mistakes should I avoid?',
    answer:
      'Avoid unnecessary complexity, tightly coupled components, missing validation, and insufficient testing.',
  },
  {
    question: 'How can I optimize performance?',
    answer:
      'Measure bottlenecks first, optimize database queries, use caching where appropriate, and avoid unnecessary processing.',
  },
  {
    question: 'Can you summarize everything?',
    answer:
      'In summary, focus on understanding the fundamentals, applying them consistently, and improving the implementation through testing.',
  },
];
