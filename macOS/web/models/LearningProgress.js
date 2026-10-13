// Generated from shared HarmonyOS sources by sync-harmony-models.cjs.
export function readLearningProgress(text, course) {
    try {
        const value = JSON.parse(text);
        if (value.schema !== 1 || value.subId !== course.subId || value.courseId !== course.courseId || !Number.isFinite(value.seconds) || value.seconds < 0 || !Number.isFinite(value.slideSeconds) || value.slideSeconds < 0)
            return undefined;
        return { schema: 1, subId: course.subId, courseId: course.courseId, seconds: value.seconds, slideId: typeof value.slideId === 'string' ? value.slideId : '', slideSeconds: value.slideSeconds, video: value.video === true, followVideo: value.followVideo !== false, savedAt: Number(value.savedAt) || 0 };
    }
    catch (_) {
        return undefined;
    }
}
export function progressPage(groups, progress) {
    const time = progress.video && progress.followVideo ? progress.seconds : progress.slideSeconds;
    const exact = groups.findIndex((group) => group.slide.id === progress.slideId);
    if ((!progress.video || !progress.followVideo) && exact >= 0)
        return exact;
    let index = 0;
    groups.forEach((group, i) => { if (group.slide.t <= time)
        index = i; });
    return index;
}
