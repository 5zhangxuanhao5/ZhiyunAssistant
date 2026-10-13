// Generated from shared HarmonyOS sources by sync-harmony-models.cjs.
import { answerParts } from './AiStream.js';
import { lessonLabel } from './CourseContext.js';
export function courseAnswerParts(answer, context) {
    const formatted = answerParts(answer), text = formatted.map((part) => part.value).join('');
    const result = [];
    const references = /[【\[]?(\d{4}-\d{2}-\d{2})[ T]+(\d{2}:\d{2})\s*(?:课次|课)?\s*(?:[·•|，,：:]|的)\s*((?:\[?\d{1,3}:\d{2}(?::\d{2})?\]?)(?:\s*(?:[、，,;/；·]|以及|和|至|到|[—–-])\s*\[?\d{1,3}:\d{2}(?::\d{2})?\]?)*)[】]?/g;
    const append = (start, end, neutral = false) => { let offset = 0; formatted.forEach((part) => { const left = Math.max(start, offset), right = Math.min(end, offset + part.value.length); if (right > left)
        result.push({ value: part.value.slice(left - offset, right - offset), seconds: neutral ? -1 : part.seconds, bold: part.bold, italic: part.italic, code: part.code }); offset += part.value.length; }); };
    let offset = 0, match = references.exec(text);
    while (match) {
        append(offset, match.index);
        const offsetPartStart = result.length;
        const lesson = context?.lessons.find((item) => lessonLabel(item.course) === match[1] + ' ' + match[2]);
        const duration = lesson ? Math.max(0, lesson.course.end - lesson.course.start, lesson.slides[lesson.slides.length - 1]?.t || 0, lesson.lines[lesson.lines.length - 1]?.end || 0) : 0;
        const clocks = /\d{1,3}:\d{2}(?::\d{2})?/g;
        const clockStart = match.index + match[0].lastIndexOf(match[3]);
        let local = 0, clock = clocks.exec(match[3]);
        while (clock) {
            append(clockStart + local, clockStart + clock.index, true);
            const values = clock[0].split(':').map((n) => Number(n)), valid = values[values.length - 1] < 60 && (values.length < 3 || values[1] < 60);
            const seconds = values.reduce((total, n) => total * 60 + n, 0);
            let at = 0;
            const style = formatted.find((part) => { at += part.value.length; return at > clockStart + clock.index; });
            const resolved = !!lesson && valid && seconds <= duration;
            result.push({ value: clock[0], seconds: resolved ? seconds : -1, course: resolved ? lesson.course : undefined, bold: style?.bold || false, italic: style?.italic || false, code: style?.code || false });
            local = clock.index + clock[0].length;
            clock = clocks.exec(match[3]);
        }
        // Insert the date heading before clocks, preserving its formatting without linking its opening time.
        const heading = [];
        let headOffset = 0;
        formatted.forEach((part) => { const left = Math.max(match.index, headOffset), right = Math.min(clockStart, headOffset + part.value.length); if (right > left)
            heading.push({ value: part.value.slice(left - headOffset, right - headOffset), seconds: -1, bold: part.bold, italic: part.italic, code: part.code }); headOffset += part.value.length; });
        const clockParts = result.splice(offsetPartStart);
        result.push(...heading);
        result.push(...clockParts);
        append(clockStart + local, match.index + match[0].length, true);
        offset = match.index + match[0].length;
        match = references.exec(text);
    }
    append(offset, text.length);
    return result;
}
export function estimatedTextTokens(text) { let units = 0; for (let i = 0; i < text.length; i++)
    units += text.charCodeAt(i) > 255 ? 1 : 0.3; return Math.ceil(units); }
