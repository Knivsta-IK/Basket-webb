import { TextStyle, Color } from '@tiptap/extension-text-style';
import { TableKit } from '@tiptap/extension-table';
const safeColor = color => /^(#[\da-f]{3,8}|rgba?\([\d.,%\s]+\))$/i.test(color || '');
export const MarkdownTextStyle = TextStyle.extend({
  parseMarkdown(token, helpers) { return helpers.applyMark('textStyle', helpers.parseInline(token.tokens || []), { color: token.color }); },
  renderMarkdown(node, helpers) { const content = helpers.renderChildren(node); return safeColor(node.attrs?.color) ? `<span style="color: ${node.attrs.color}">${content}</span>` : content; },
  markdownTokenizer: { name: 'textStyle', level: 'inline', start: src => src.indexOf('<span'), tokenize(src, _tokens, lexer) {
    const match = /^<span\s+style="color:\s*([^";]+);?">([\s\S]*?)<\/span>/i.exec(src);
    if (!match || !safeColor(match[1])) return;
    return { type: 'textStyle', raw: match[0], color: match[1], tokens: lexer.inlineTokens(match[2]) };
  } },
});
export const richExtensions = () => [MarkdownTextStyle, Color, TableKit.configure({ table: { resizable: false } })];
