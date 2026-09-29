import { eslintCompatPlugin } from '@oxlint/plugins';

export default eslintCompatPlugin({
  meta: { name: 'project' },
  rules: {
    'require-disable-reason': {
      meta: {
        type: 'problem',
        schema: [],
        messages: {
          missing:
            'Name the disabled rules and explain the exception after --.',
        },
      },
      create(context) {
        return {
          Program() {
            for (const comment of context.sourceCode.getAllComments()) {
              const directive = comment.value.trim();
              if (
                !/^(?:eslint|oxlint)-disable(?:-next-line|-line)?\b/u.test(
                  directive,
                )
              ) {
                continue;
              }
              const match =
                /^(?:eslint|oxlint)-disable(?:-next-line|-line)?\s+(.+?)\s+--\s+(\S[\s\S]*)$/u.exec(
                  directive,
                );
              if (!match || !match[1].trim() || !match[2].trim()) {
                context.report({ loc: comment.loc, messageId: 'missing' });
              }
            }
          },
        };
      },
    },
  },
});
