import { shanghaiDate, clockTime, stamp } from './Timeline.js';
export function priorLessons(rows, current, includeLater = false) {
    const unique = new Map();
    rows.forEach((row) => { if (row.courseId === current.courseId && row.subId !== current.subId && Number.isFinite(row.start) && row.start > 0 && (includeLater ? row.start <= Date.now() / 1000 : row.start < current.start))
        unique.set(row.subId, row); });
    return Array.from(unique.values()).sort((a, b) => a.start - b.start || a.subId.localeCompare(b.subId));
}
export function lessonLabel(course) { return shanghaiDate(course.start) + ' ' + clockTime(course.start); }
export function priorMaterial(context) {
    return context.gaps.map((gap) => '材料缺口：' + gap).join('\n') + '\n' + context.lessons.map((lesson, index) => {
        const header = `【${context.wholeCourse ? '关联' : '前序'}课次${index + 1}：${lessonLabel(lesson.course)}】`;
        const pages = lesson.slides.map((slide, i) => `课件第${i + 1}页，课内时间${stamp(slide.t)}—${lesson.slides[i + 1] ? stamp(lesson.slides[i + 1].t) : '课次结束'}`).join('\n');
        // Keep every sentence, including speech before the first slide; times are local to this lesson.
        const speech = lesson.lines.map((line) => `${lessonLabel(lesson.course)}课次 ${stamp(line.t)} ${line.text}`).join('\n');
        return header + '\n' + lesson.gaps.map((gap) => '材料缺口：' + gap).join('\n') + '\n课件时间索引：\n' + pages + '\n此课次完整可用转写：\n' + speech;
    }).join('\n\n');
}
