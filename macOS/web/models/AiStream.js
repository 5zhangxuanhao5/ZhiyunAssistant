export class AiStream {
    constructor() {
        this.buffer = '';
        this.usage = undefined;
        this.answer = '';
        this.calls = [];
        this.done = false;
    }
    push(chunk, changed) {
        this.buffer += chunk;
        let boundary = this.buffer.indexOf('\n');
        while (boundary >= 0) {
            const line = this.buffer.slice(0, boundary).trim();
            this.buffer = this.buffer.slice(boundary + 1);
            if (line.startsWith('data:')) {
                const data = line.slice(5).trim();
                if (data === '[DONE]')
                    this.done = true;
                else if (data) {
                    const event = JSON.parse(data);
                    if (event.usage)
                        this.usage = event.usage;
                    if (event.error)
                        throw new Error('AI 服务返回错误，请重试');
                    const delta = event.choices?.[0]?.delta;
                    if (delta?.content) {
                        this.answer += delta.content;
                        changed(this.answer);
                    }
                    delta?.tool_calls?.forEach((part) => {
                        if (!this.calls[part.index])
                            this.calls[part.index] = { id: '', type: 'function', function: { name: '', arguments: '' } };
                        const call = this.calls[part.index];
                        if (part.id)
                            call.id += part.id;
                        if (part.function?.name)
                            call.function.name += part.function.name;
                        if (part.function?.arguments)
                            call.function.arguments += part.function.arguments;
                    });
                }
            }
            boundary = this.buffer.indexOf('\n');
        }
    }
    finish(changed) { if (this.buffer.trim())
        this.push('\n', changed); }
}
export function shouldSubmitOnEnter(shiftPressed) { return !shiftPressed; }
export function answerParts(answer) {
    const parts = [];
    const append = (value, bold, italic, code) => {
        if (!value)
            return;
        const previous = parts[parts.length - 1];
        if (previous && previous.seconds < 0 && previous.bold === bold && previous.italic === italic && previous.code === code)
            previous.value += value;
        else
            parts.push({ value, seconds: -1, bold, italic, code });
    };
    const time = /^\[\d{1,3}:\d{2}(?::\d{2})?(?:\s*[—–-]\s*\d{1,3}:\d{2}(?::\d{2})?)?\]$/;
    const inline = /(\[\d{1,3}:\d{2}(?::\d{2})?(?:\s*[—–-]\s*\d{1,3}:\d{2}(?::\d{2})?)?\]|\*\*[^*]+?\*\*|__[^_]+?__|\*[^*]+?\*|_[^_]+?_|`[^`]+?`)/g;
    const lines = answer.split('\n');
    lines.forEach((raw, lineIndex) => {
        let line = raw, lineBold = false;
        if (/^\s*```/.test(line))
            line = '';
        const heading = /^\s{0,3}(#{1,6})\s+/.exec(line);
        if (heading) {
            lineBold = true;
            line = line.slice(heading[0].length);
        }
        const bullet = /^\s*[*+-]\s+/.exec(line);
        if (bullet)
            line = /^\s*/.exec(line)[0] + '• ' + line.slice(bullet[0].length);
        line = line.replace(/\s+#{1,6}\s*$/, '');
        let previous = 0, match = inline.exec(line);
        while (match) {
            if (match.index > previous)
                append(line.slice(previous, match.index).replace(/\*\*/g, '').replace(/__/g, ''), lineBold, false, false);
            const token = match[0];
            if (time.test(token)) {
                time.lastIndex = 0;
                parts.push({ value: token, seconds: token.slice(1, -1).split(/[—–-]/)[0].trim().split(':').reduce((total, n) => total * 60 + Number(n), 0), bold: lineBold, italic: false, code: false });
            }
            else if (token.startsWith('**') || token.startsWith('__'))
                append(token.slice(2, -2), true, false, false);
            else if (token.startsWith('`'))
                append(token.slice(1, -1), lineBold, false, true);
            else
                append(token.slice(1, -1), lineBold, true, false);
            previous = match.index + token.length;
            match = inline.exec(line);
        }
        if (previous < line.length)
            append(line.slice(previous).replace(/\*\*/g, '').replace(/__/g, ''), lineBold, false, false);
        if (lineIndex < lines.length - 1)
            append('\n', false, false, false);
        inline.lastIndex = 0;
    });
    return parts;
}
