import { ChatStore } from '../services/ChatStore';
import { SummaryCache } from '../services/SummaryCache';
import { ReturnAction } from '../components/ReturnAction';
import { AiClient } from '../services/AiClient';
import { SmartSkipService, SkipProgress } from '../services/SmartSkipService';
import { SkipRange, filteredTranscript, automaticSkip, fillerOnly } from '../model/SmartSkip';
import { SelectionKeys } from '../model/SelectionKeys';
import { SummaryView, SummaryViewController } from '../model/SummaryView';
import { NativeSelections } from '../model/NativeSelections';
import { NoteContentReference } from '../model/Notes';
import { PaneChoices, PanePreferences, defaultPaneChoices, chosenPanes, rememberPaneChoices, missingPaneKey } from '../model/PanePreferences';
import { CourseCollections, CollectionCourse, CollectionStorage } from '../model/CourseCollections';
import { CollectionActions } from '../components/CollectionActions';
import { CollectionsPage } from '../components/CollectionsPage';
import { MyCourses } from '../components/MyCourses';
import { PhysicalInput } from '../services/PhysicalInput';
import { SlideSimilarityStore } from '../services/SlideSimilarityStore';
import { DropdownLabel } from '../components/DropdownLabel';
import { sensor } from '@kit.SensorServiceKit';
import { physicalDigit } from '../model/KeyboardInput';
import { gravityOrientation } from '../model/GravityOrientation';
import { deviceInfo } from '@kit.BasicServicesKit';
import { PaneFrame } from '../components/PaneFrame';
import { PaneRect, defaultPanes, normalizePane, validPanes, layoutKey, matchingLayout, reorderPanes } from '../model/PaneLayout';
import { NotesPane } from '../components/NotesPane';
import { PrivacyPage } from '../components/PrivacyPage';
import { PrivacyService } from '../services/PrivacyService';
import { LessonDownload } from '../components/LessonDownload';
import { CacheSettings } from '../components/CacheSettings';
import { NotesLibrary } from '../components/NotesLibrary';
import { LessonNote, NotesController, NoteInsertion } from '../model/Notes';
import { window, promptAction } from '@kit.ArkUI';
import { MediaSource } from '../model/Media';
import { PlaybackController, PlaybackState } from '../services/PlaybackController';
import { OfflineLibrary, OfflineCourse, DownloadJob, DownloadOptions } from '../services/OfflineLibrary';
import { VideoPane } from '../components/VideoPane';
import { SlideOverview } from '../components/SlideOverview';
import { PageJumpDialog } from '../components/PageJumpDialog';
import { DownloadSheet } from '../components/DownloadSheet';
import { OfflineScreen } from '../components/OfflineScreen';
import { PageSummary } from '../components/PageSummary';
import { AiPanel, AiContext } from '../components/AiPanel';
import { KeyCode } from '@kit.InputKit';
import { VideoNetwork } from '../services/VideoNetwork';
import { manualPage, displayedGroups } from '../model/StudyNavigation';
import { SessionStore } from '../services/SessionStore';
import { inspectLoginScript, submitLoginScript, officialDigitScript, officialLoginUrl, webString } from '../model/OfficialLogin';
import { common } from '@kit.AbilityKit';
import { webview } from '@kit.ArkWeb';
import { Account, Course, copyStringMap, Slide, Transcript, PageGroup, phase, shanghaiDate, clockTime, stamp, distinctSlides, groupPages, mergeSlides, mergeLines, reconcileLines, pageCapacity, selectedAfterUpdate, visiblePageGroups, spreadStart } from '../model/Timeline';
import { Zhiyun, SubInfo, AccessDenied } from '../services/Zhiyun';
import { LocalStore, Snapshot, key } from '../services/LocalStore';
import { LearningProgress, readLearningProgress, progressPage } from '../model/LearningProgress';
import { TranscriptPane } from '../components/TranscriptPane';
import { TranscriptText } from '../components/TranscriptText';
import { SlidePager } from '../components/SlidePager';
import { TimeJumpDialog } from '../components/TimeJumpDialog';
import { CourseList } from '../components/CourseList';
import { Plaza } from '../components/Plaza';
import { LiveTranscript } from '../services/LiveTranscript';
import { LayoutPanel } from '../components/LayoutPanel';

interface StudyReturnPoint { subId: string; at: number; slideId: string; following: boolean; followVideo: boolean; followTranscript: boolean; summary?: SummaryView; reference?: NoteContentReference }
interface SavedPaneLayouts { profiles: Record<string, PaneRect[]>; locks?: Record<string, boolean> }
interface LoginStatus { ready: boolean; captcha: boolean; error: string }

interface CourseJump { course: Course; at: number; video: boolean; offline?: OfflineCourse; summary?: SummaryView; panes?: PaneChoices; rects?: PaneRect[]; slideId?: string; activePane?: string; following?: boolean; followVideo?: boolean; followTranscript?: boolean }
@Entry
@Component
struct Index {
  @State screen: string = 'home';
  @State authUser: string = '';
  @State authPassword: string = '';
  @State authReady: boolean = false;
  @State authSubmitting: boolean = false;
  @State authOfficial: boolean = false;
  @State authError: string = '';
  private authTimer: number = -1;
  private authSubmitted: boolean = false;
  private authReturnHandled: boolean = false;
  @State account: Account | undefined = undefined;
  @State courses: Course[] = [];
  @State coursePermissions: Record<string, string> = {};
  @State course: Course | undefined = undefined;
  @State slides: Slide[] = [];
  @State lines: Transcript[] = [];
  @State groups: PageGroup[] = [];
  @State selected: number = 0;
  @State following: boolean = true;
  @State slidesEnabled: boolean = true;
  @State transcription: boolean = true;
  @State trimBorders: boolean = true;
  @State mergeDuplicateSlides: boolean = true;
  @State entryPaused: boolean = false;
  @State requestedNoteId: string = '';
  @State videoFullscreen: boolean = false;
  @StorageLink('safeTop') safeTop: number = 0;
  @StorageLink('safeBottom') safeBottom: number = 0;
  @StorageLink('safeLeft') safeLeft: number = 0;
  @StorageLink('safeRight') safeRight: number = 0;
  @State smartSkip: boolean = false;
  @State skipSparse: boolean = false;
  @State skipRanges: SkipRange[] = [];
  @State skipStatus: string = '';
  @State skipPreparing: boolean = false;
  @State skipProgress: SkipProgress = { completed: 0, total: 0, failed: 0, running: false };
  private skipModePrompted: boolean = false;
  private skipNoMatchPending: boolean = false;
  private smartFilter: SmartSkipService = new SmartSkipService();
  private smartRangesKey: string = '';
  private lastAutomaticRange: string = '';
  @State skipEmpty: boolean = false;
  private groupedSlides: Slide[] | undefined = undefined;
  private groupedLines: Transcript[] | undefined = undefined;
  private groupedRanges: SkipRange[] | undefined = undefined;
  private groupedOptions: string = '';
  private rawGroups: PageGroup[] = [];
  private historyReady: boolean = false;
  private imageRevision: number = 0;
  private forcePermissionRefresh: boolean = true;
  @State transcriptState: string = '';
  @State message: string = '';
  @State syncState: string = '';
  @State imageUris: Record<string, string> = {};
  @State windowWidth: number = 1000;
  @State windowHeight: number = 700;
  @State capacity: number = 1;
  @State demo: boolean = false;
  @State @Watch('rotationWatch') showVideo: boolean = false;
  @State videoBusy: boolean = false;
  @State videoSources: MediaSource[] = [];
  @State videoSource: MediaSource | undefined = undefined;
  @State videoTime: number = 0;
  @State videoInitialSeconds: number = 0;
  @State liveReplay: boolean = false;
  private videoSeekable: boolean = false;
  private videoEnd: number = 0;
  private replaySources: MediaSource[] = [];
  @State videoRate: number = 1;
  @State videoAspect: number = 16 / 9;
  @StorageLink('videoShare') videoShare: number = 0.44;
  @StorageLink('slideShare') slideShare: number = 0.64;
  @StorageLink('dockShare') dockShare: number = 0.30;
  @State studyWidth: number = 1000;
  @State studyHeight: number = 700;
  @State followVideo: boolean = true;
  @State overview: boolean = false;
  @State layoutOpen: boolean = false;
  @State paneRects: PaneRect[] = [];
  @State selectingPane: string = '';
  private paneSelecting(id: string, active: boolean): void { if (active) this.selectingPane = id; else if (this.selectingPane === id) this.selectingPane = ''; }
  @State workspaceWidth: number = 1000;
  @State workspaceHeight: number = 600;
  @State slideFullscreen: boolean = false;
  @State slideZoom: number = 1;
  private savedLayouts: Record<string, PaneRect[]> = {};
  private layoutContext: string = '';
  private savedLayoutLocks: Record<string, boolean> = {};
  @State layoutLocked: boolean = false;
  @State editingPane: string = '';
  @State expandedSlideId: string = '';
  private workspaceScroller: Scroller = new Scroller();
  private savedOrientation: window.Orientation = window.Orientation.UNSPECIFIED;
  private loginField: string = 'login-account';
  private loginAccountInput: PhysicalInput = new PhysicalInput();
  private loginAccountController: TextInputController = this.loginAccountInput.controller;
  private loginPasswordInput: PhysicalInput = new PhysicalInput();
  private loginPasswordController: TextInputController = this.loginPasswordInput.controller;
  private gravityListening: boolean = false;
  private gravityDirection: string = 'portrait';
  private gravitySuppressed: boolean = false;
  private gravityCandidate: string = '';
  private gravityCandidateAt: number = 0;
  private gravityCallback: (value: sensor.GravityResponse) => void = (value: sensor.GravityResponse) => {
    const direction = gravityOrientation(value.x, value.y);
    if (!direction) { this.gravityCandidate = ''; return; }
    if (direction !== this.gravityCandidate) { this.gravityCandidate = direction; this.gravityCandidateAt = Date.now(); return; }
    if (Date.now() - this.gravityCandidateAt < 400 || direction === this.gravityDirection) return;
    this.gravityDirection = direction;
    if (direction === 'portrait') { this.gravitySuppressed = false; if (this.videoFullscreen) this.fullscreen(false, true); }
    else if (!this.gravitySuppressed && this.showVideo && this.foreground) this.fullscreen(true, true);
  };
  @State aiOpen: boolean = false;
  @State aiCreated: boolean = false;
  @State notesOpen: boolean = false;
  @State notesCreated: boolean = false;
  @State privacyOpen: boolean = false;
  @State privacyAccepted: boolean = false;
  @State cacheSettings: boolean = false;
  @State notesBackSequence: number = 0;
  @State cacheBackSequence: number = 0;
  @State notesLibrary: boolean = false;
  @State dock: string = 'ai';
  @State narrowStudy: boolean = true;
  @State summaryOpen: boolean = false;
  @State summaryCreated: boolean = false;
  @State aiPagePicker: boolean = false;
  @State aiSelectedIds: string[] = [];
  @State settingsCustomizeOpen: boolean = false;
  @State pinnedSettings: string[] = ['slides', 'transcript', 'video'];
  private featureIds: string[] = ['slides', 'transcript', 'video', 'overview', 'notes', 'ai', 'summary', 'layout', 'borders', 'merge', 'skip', 'smartSkip', 'latest', 'time', 'page', 'download'];
  @State followTranscript: boolean = true;
  @State highlightRevision: number = 0;
  @State slideCount: number = 0;
  @State highlightAt: number = -1;
  @State imageHighlightId: string = '';
  @State highlightSource: string = '';
  private highlightTimer: number = -1;
  private inputFocused: boolean = false;
  private notes: NotesController = new NotesController();
  @State lessonDownloadOpen: boolean = false;
  @State downloadScoped: boolean = false;
  @State downloadsOpen: boolean = false;
  @State downloadBackSequence: number = 0;
  @State downloadCourses: Course[] = [];
  @State offlineOpen: boolean = false;
  @State offlineViewing: boolean = false;
  @State offlineEntries: OfflineCourse[] = [];
  @State downloadDiscovered: Course[] = [];
  @State downloadScopeChecking: boolean = false;
  @State downloadScopeRefresh: number = 0;
  @State downloadJobs: DownloadJob[] = [];
  private library: OfflineLibrary | undefined = undefined;
  private playback: PlaybackController = new PlaybackController();
  private offlineItem: OfflineCourse | undefined = undefined;
  private offlineReturn: boolean = false;
  private imageQueue: Slide[] = [];
  private loadingImage: boolean = false;

  @State busy: boolean = false;
  @State recent: boolean = false;
  @State myCoursesTab: string = 'today';
  @State myCoursesHomeSequence: number = 0;
  @State collectionPage: string = '';
  @State collectionRootSequence: number = 0;
  @State collectionBackSequence: number = 0;
  @State collectionRevision: number = 0;
  private collections: CourseCollections = new CourseCollections();
  @State allCoursesOpen: boolean = false;
  @State allCoursesBackSequence: number = 0;
  @State plaza: boolean = false;
  @State plazaBackSequence: number = 0;
  @State now: number = Date.now() / 1000;
  @StorageLink('foreground') @Watch('visibilityChanged') foreground: boolean = true;
  @StorageLink('screenWidth') screenWidth: number = 1920;
  @StorageLink('screenHeight') screenHeight: number = 1280;
  private web: webview.WebviewController = new webview.WebviewController();
  private api: Zhiyun = new Zhiyun();
  private live: LiveTranscript = new LiveTranscript();
  private liveAddress: string = '';
  private sourceProbe: VideoNetwork = new VideoNetwork();
  private cameraCandidates: MediaSource[] = [];
  private cameraProbeStarted: boolean = false;
  private cameraProbeTimer: number = -1;
  private cancelCameraProbe(): void { clearTimeout(this.cameraProbeTimer); this.cameraProbeStarted = false; this.sourceProbe.cancel(); }
  private probeReady(state: PlaybackState): void {
    if (!this.foreground || !this.showVideo || !this.cameraCandidates.length || this.cameraProbeStarted || !state.positionReady || !state.width) return;
    this.cameraProbeStarted = true; const gen = this.generation, sourceId = this.videoSource?.id, cameras = this.cameraCandidates;
    this.cameraProbeTimer = setTimeout(() => {
      if (gen !== this.generation || !this.foreground || !this.showVideo) return;
      this.sourceProbe.uniqueSources(cameras).then((checked: MediaSource[]) => { if (gen === this.generation && this.showVideo && this.videoSource?.id === sourceId) { this.videoSources = checked; this.cameraCandidates = []; } }).catch(() => { if (gen === this.generation) this.cameraProbeStarted = false; });
    }, 600);
  }
  private liveCaptionState: string = '';
  @State historicalCaptionMissing: boolean = false;
  private historyPollAt: number = 0;
  private store: LocalStore | undefined = undefined;
  private timer: number = -1;
  private generation: number = 0;
  private failureCount: number = 0;
  private info: SubInfo | undefined = undefined;
  private jumpingDialogOpen: boolean = false;
  private jumpDialog: CustomDialogController = new CustomDialogController({ builder: TimeJumpDialog({ maxSeconds: this.lessonDuration(), initialSeconds: this.showVideo ? this.videoTime : this.groups[this.selected]?.slide.t || 0, onJump: (seconds: number) => this.jumpToTime(seconds) }), autoCancel: true, onWillAppear: () => { this.jumpingDialogOpen = true; }, onWillDisappear: () => { this.jumpingDialogOpen = false; } });
  private pageDialog: CustomDialogController = new CustomDialogController({ builder: PageJumpDialog({ initialPage: this.presentationSlides().findIndex((s: Slide) => s.id === this.groups[this.selected]?.slide.id) + 1, pages: this.presentationSlides().length, onJump: (page: number) => this.jumpToPage(page) }), autoCancel: true, onWillAppear: () => { this.jumpingDialogOpen = true; }, onWillDisappear: () => { this.jumpingDialogOpen = false; } });
  private authProbe: boolean = false;
  private authRetry: number = -1;
  private catalogAt: number = 0;
  private permissionAt: number = 0;
  private permissionLive: boolean = false;
  private initialPosition: boolean = true;
  private summaryController: SummaryViewController = new SummaryViewController();
  @State summaryResume: SummaryView | undefined = undefined;
  private courseReturnStack: CourseJump[] = [];
  private pendingCourseJump: CourseJump | undefined = undefined;
  private pendingProgress: LearningProgress | undefined = undefined;
  private progressReady: boolean = false;
  private progressSavedAt: number = 0;
  private textStudyTime: number = 0;
  private saveProgress(force: boolean = false): void {
    if (!this.progressReady || !this.store || !this.course || this.demo || this.screen !== 'lesson' || (!this.showVideo && !this.groups.length && !this.lines.length)) return;
    const now = Date.now(); if (!force && now - this.progressSavedAt < 3000) return;
    const page = this.groups[this.selected]?.slide;
    const value: LearningProgress = { schema: 1, subId: this.course.subId, courseId: this.course.courseId, seconds: Math.max(0, this.learningTime()), slideId: page?.id || '', slideSeconds: page?.t || 0, video: this.showVideo, followVideo: this.followVideo, savedAt: now };
    try { this.store.saveJson('progress-' + key(this.course.subId) + '.json', JSON.stringify(value)); this.progressSavedAt = now; } catch (_) {}
  }
  private loadProgress(course: Course): void {
    this.pendingProgress = readLearningProgress(this.store?.readJson('progress-' + key(course.subId) + '.json') || '', course);
    this.progressReady = false; this.progressSavedAt = 0; this.textStudyTime = 0;
  }
  private async restoreProgress(): Promise<void> {
    if (this.progressReady) return;
    const saved = this.pendingProgress, gen = this.generation, reference = this.pendingCourseJump; this.pendingCourseJump = undefined;
    this.pendingProgress = undefined; this.progressReady = true;
    if (reference) {
      this.following = false;
      if (reference.video && (!this.offlineViewing || !!this.offlineItem?.videoUri)) await this.toggleVideo(reference.at);
      if (gen === this.generation) {
        this.rewind(reference.at, '', '', false, !reference.panes);
        if (reference.panes) {
          this.slidesEnabled = reference.panes.slides; this.transcription = reference.panes.transcript;
          this.notesCreated = this.notesOpen = reference.panes.notes; this.aiCreated = this.aiOpen = reference.panes.ai; this.summaryCreated = this.summaryOpen = reference.panes.summary;
          this.summaryResume = reference.summary; this.activePane = reference.activePane || 'slides';
          const page = this.groups.findIndex((group: PageGroup) => group.slide.id === reference.slideId); if (page >= 0) this.selected = page;
          this.following = reference.following === true; this.followVideo = reference.followVideo === true; this.followTranscript = reference.followTranscript === true;
          if (reference.rects) { this.layoutContext = layoutKey(this.activePanes(), this.windowWidth, this.windowHeight); this.paneRects = reference.rects.map((rect: PaneRect): PaneRect => { return { id: rect.id, x: rect.x, y: rect.y, w: rect.w, h: rect.h, z: rect.z }; }); }
          this.resize(); if (page >= 0) this.selected = page;
        }
      }
      return;
    }
    if (!saved || Number(this.info?.sub_status) === 1) { this.skipOpeningPages(); return; }
    this.selected = progressPage(this.groups, saved); this.skipOpeningPages(); this.following = false; this.textStudyTime = saved.seconds;
    if (!this.groups.length && this.lines.length) this.rewind(saved.seconds);
    this.followVideo = saved.followVideo; this.followTranscript = saved.followVideo;
    this.prepareImages(gen);
    if (this.preferredVideo && saved.video && !this.showVideo && (!this.offlineViewing || !!this.offlineItem?.videoUri)) {
      const duration = this.lessonDuration();
      await this.toggleVideo(duration > 0 ? Math.min(saved.seconds, duration) : saved.seconds);
      if (gen === this.generation) { this.followVideo = saved.followVideo; this.followTranscript = saved.followVideo; if (this.followVideo) this.followPlayback(); }
    }
  }

  aboutToAppear(): void {
    this.collections.onChange = () => this.collectionRevision++;
    this.privacyAccepted = new PrivacyService(this.getUIContext().getHostContext() as common.UIAbilityContext).accepted();
    this.privacyOpen = !this.privacyAccepted;
    if (this.privacyAccepted) this.restoreAccount();
  }
  private async restoreAccount(): Promise<void> { const gen = this.generation; await SessionStore.restore(); const account = await SessionStore.savedAccount(); if (gen !== this.generation || !this.privacyAccepted) return; if (account && !this.account) { this.account = account; this.initializeStore(account); this.screen = 'home'; } this.resume(); }
  private initializeStore(account: Account): void {
    const context = this.getUIContext().getHostContext() as common.UIAbilityContext;
    this.library?.pause();
    this.store = new LocalStore(context, account.tenantId + ':' + account.id); this.collections.bind(this.store as CollectionStorage);
    const savedTab = this.store.readJson('my-courses-tab.txt'); this.myCoursesTab = savedTab === 'recent' || savedTab === 'all' ? savedTab : 'today'; this.recent = this.myCoursesTab === 'recent';
    const imageStore = this.store;
    this.store.onImageUpdated = (url: string) => { if (this.screen !== 'lesson' || this.store !== imageStore) return; const ids = this.slides.filter((slide: Slide) => slide.url === url).map((slide: Slide) => slide.id); const uris: Record<string, string> = {}; Object.keys(this.imageUris).filter((id: string) => !ids.includes(id)).forEach((id: string) => uris[id] = this.imageUris[id]); this.imageRevision++; this.imageUris = uris; this.prepareImages(this.generation); this.reconcileSlideDuplicates(this.generation); };
    this.library = new OfflineLibrary(this.store, (progressOnly?: boolean) => this.refreshLibrary(progressOnly));
    this.api.usePermissionStorage(this.store);
    this.trimBorders = this.store.trimBorders(); this.transcription = this.store.transcription(); this.slidesEnabled = this.store.slides(); this.skipEmpty = this.store.skipEmpty(); this.smartSkip = false; this.skipSparse = this.store.readJson('smart-skip-sparse.txt') === 'true'; this.mergeDuplicateSlides = this.store.readJson('merge-duplicate-slides.txt') !== 'false';
    try { const layout = JSON.parse(this.store.readJson('pane-layout-v2.json')) as SavedPaneLayouts; this.savedLayouts = layout.profiles || {}; this.savedLayoutLocks = layout.locks || {}; } catch (_) { this.savedLayouts = {}; this.savedLayoutLocks = {}; }
    try { const ids = JSON.parse(this.store.readJson('pinned-settings.json')) as string[]; if (Array.isArray(ids)) this.pinnedSettings = ids.filter((id: string) => this.featureIds.includes(id)); } catch (_) {}
    try { const saved = JSON.parse(this.store.readJson('pane-choices-v1.json')) as PanePreferences; this.panePreferences = { regular: saved.regular || defaultPaneChoices(), missing: saved.missing || {} }; } catch (_) { this.panePreferences = { regular: defaultPaneChoices(), missing: {} }; }
    this.layoutContext = '';
    this.refreshLibrary(); this.resize();
    try { OfflineLibrary.removeLegacyAccount(context); } catch (_) {}
  }
  private refreshLibrary(progressOnly: boolean = false): void { if (progressOnly && !this.offlineOpen && !this.downloadsOpen) return; const entries = this.library?.list() || []; if (this.offlineEntries !== entries) this.offlineEntries = entries; this.downloadJobs = this.library?.tasks() || []; }

  onBackPress(): boolean {
    if (this.jumpingDialogOpen) { this.jumpDialog.close(); this.pageDialog.close(); this.jumpingDialogOpen = false; return true; }
    if (this.privacyOpen) { this.privacyOpen = false; return true; }
    if (this.lessonDownloadOpen) { this.lessonDownloadOpen = false; return true; }
    if (this.cacheSettings) { this.cacheBackSequence++; return true; }
    if (this.settingsCustomizeOpen) { this.settingsCustomizeOpen = false; return true; }
    if (this.aiPagePicker) { this.aiPagePicker = false; return true; }
    if (this.downloadsOpen) { this.downloadBackSequence++; return true; }
    if (this.layoutOpen) { this.layoutOpen = false; return true; }
    if (this.overview) { this.overview = false; return true; }
    if (this.slideFullscreen) { this.slideFullscreen = false; return true; }
    if (this.videoFullscreen) { this.fullscreen(false); return true; }
    if (this.screen === 'lesson' || this.screen === 'waiting') { if (this.courseReturnStack.length) this.returnReferencedCourse(); else this.home(); return true; }

    if (this.notesLibrary) { this.notesBackSequence++; return true; }
    if (this.offlineOpen) { this.openHomePage(''); return true; }

    if (this.screen === 'login') {
      if (this.authOfficial) { this.authOfficial = false; this.authSubmitting = false; this.authSubmitted = false; this.authPassword = ''; clearTimeout(this.authTimer); clearTimeout(this.authRetry); }
      else this.leaveLogin();
      return true;
    }
    if (this.collectionPage) { this.collectionBackSequence++; return true; }
    if (this.plaza) { this.plazaBackSequence++; return true; }
    if (this.allCoursesOpen) { this.allCoursesBackSequence++; return true; }
    return false;
  }
  private leaveLogin(): void {
    this.authPassword = ''; this.authSubmitting = false; this.authSubmitted = false; this.authOfficial = false;
    clearTimeout(this.authTimer); clearTimeout(this.authRetry); this.screen = 'home'; this.resume();
  }
  aboutToDisappear(): void { this.saveProgress(true); this.stopGravity(); this.authPassword = ''; clearTimeout(this.authTimer); clearTimeout(this.authRetry); this.stop(); }
  private visibilityChanged(): void { this.rotationWatch(); if (this.foreground) this.resume(); else { this.saveProgress(true); this.playback.pause(); this.library?.pause(); this.stop(); } }
  private stop(): void {
    this.cancelCameraProbe();
    if (this.course && this.screen === 'lesson' && !this.offlineViewing && !this.demo) { try { this.store?.save({ course: this.course, slides: this.slides, lines: this.lines, savedAt: Date.now() }); } catch (_) {} }
    this.smartFilter.cancel(); SelectionKeys.reset(); this.store?.cache.flush(); this.generation++; clearTimeout(this.timer); this.api.cancel(); this.store?.cancel(); this.live.close(); this.liveAddress = ''; this.liveCaptionState = ''; this.busy = false;
  }
  private resume(): void {
    if (!this.privacyAccepted) return;
    if (this.screen === 'home' && !this.plaza) { this.catalogAt = 0; this.forcePermissionRefresh = true; }
    this.stop();
    if (this.foreground && !this.demo && !this.offlineViewing) this.tick();
    else if (this.offlineViewing) this.prepareImages(this.generation);
  }
  private schedule(delay: number): void {
    clearTimeout(this.timer);
    if (this.foreground && !this.demo && !this.offlineViewing) this.timer = setTimeout(() => this.tick(), delay);
  }
  private async tick(): Promise<void> {
    if (this.busy || !this.foreground || this.demo || this.offlineViewing || this.offlineOpen) return;
    this.busy = true;
    const gen = this.generation;
    this.now = Date.now() / 1000;
    try {
      if (!this.account || this.screen === 'login') {
        const account = await this.api.account();
        if (gen !== this.generation) return;
        const saved = await SessionStore.saveCurrent().then(() => true).catch(() => false);
        if (gen !== this.generation) return;
        await SessionStore.rememberAccount(account).catch(() => {}); if (gen !== this.generation) return; this.account = account;
        this.initializeStore(account);
        this.screen = 'home'; this.message = saved ? '' : '登录状态暂未保存，下次可能需要重新登录'; this.catalogAt = 0;
        this.authPassword = ''; this.authSubmitting = false; clearTimeout(this.authTimer); clearTimeout(this.authRetry);
        webview.WebCookieManager.saveCookieAsync().catch(() => {});
      }
      if (this.screen === 'home' && !this.plaza && !this.allCoursesOpen && this.now - this.catalogAt > 30) {
        const courses = await this.api.courses(this.account!);
        if (gen !== this.generation) return;
        this.now = Date.now() / 1000; this.courses = courses; this.coursePermissions = this.api.cachedPermissions(courses); this.catalogAt = this.now; this.message = '';
        const force = this.forcePermissionRefresh; this.forcePermissionRefresh = false;
        await Promise.all([this.api.refreshToday(courses), this.api.permissions(courses, (states: Record<string, string>) => {
          if (gen === this.generation) this.coursePermissions = copyStringMap(states);
        }, force)]);
        if (gen !== this.generation) return;
        this.courses = courses.slice(); this.coursePermissions = this.api.cachedPermissions(courses);
      }
      if (this.course && (this.screen === 'waiting' || this.screen === 'lesson')) {
        await this.syncLesson(gen);
      }
      if (gen !== this.generation) return;
      this.failureCount = 0;
    } catch (err) {
      if (gen !== this.generation) return;
      this.failureCount++;
      if (err instanceof AccessDenied && this.course) {
        if (this.courseReturnStack.length) { this.returnReferencedCourse(); this.message = '引用课次当前无法访问，已返回原课程'; return; }
        this.live.close(); this.liveAddress = ''; this.store?.cancel();
        this.slides = []; this.lines = []; this.groups = []; this.imageUris = {}; this.screen = 'home'; this.course = undefined;
        this.syncState = '当前账号没有这节课的访问权限';
      }
      if (this.account) this.message = (err as Error).message || '连接暂时中断，恢复后会自动补齐';
      else this.message = '';
    } finally {
      if (gen === this.generation) {
        this.busy = false;
        const normal = this.screen === 'login' ? 1000 : this.screen === 'lesson' ? (Number(this.info?.sub_status) !== 1 ? ((this.transcription || this.skipEmpty) && !this.lines.length ? 8000 : 60000) : (this.transcription || this.skipEmpty || this.smartSkip || this.aiOpen || this.summaryOpen) ? 4000 : 8000) : this.screen === 'waiting' ? 5000 : 15000;
        this.schedule(this.screen === 'login' ? normal : this.failureCount ? Math.min(60000, Math.max(normal, 3000) * Math.pow(2, Math.min(4, this.failureCount))) : normal);
      }
    }
  }
  private async syncLesson(gen: number): Promise<void> {
    const course = this.course!;
    const info = await this.api.info(course);
    if (gen !== this.generation) return;
    if (JSON.stringify(this.info) !== JSON.stringify(info)) this.info = info;
    course.status = String(info.sub_status || course.status);
    if (Number(info.start_at) > 0) {
      course.start = Number(info.start_at);
    }
    const status = Number(info.sub_status);
    if (status === 2) {
      this.live.close(); this.liveAddress = ''; this.screen = 'waiting'; this.syncState = '等待老师开始上课'; return;
    }
    if (status === 3 || status === 9) {
      this.live.close(); this.liveAddress = ''; this.syncState = '课程已结束，等待平台生成回放';
      if (this.slides.length || this.lines.length) this.screen = 'lesson';
      if ((this.transcription || this.skipEmpty || this.smartSkip || this.aiOpen || this.summaryOpen) && this.now - this.historyPollAt >= 15) {
        await this.syncTranscripts(course, gen);
        if (gen === this.generation && !this.lines.some((line: Transcript) => line.timing === 'history')) this.historicalCaptionMissing = true;
      }
      return;
    }
    if (this.screen === 'waiting' || this.now - this.permissionAt >= 60 || this.permissionLive !== (status === 1)) {
      await this.api.checkPermission(course, status === 1);
      if (gen !== this.generation) return;
      this.permissionAt = this.now; this.permissionLive = status === 1; this.screen = 'lesson';
    }
    // Connect captions before fetching PPT history; new sentences must not wait for image pagination.
    const wantsCaptions = this.transcription || this.skipEmpty || this.smartSkip || this.aiOpen || this.summaryOpen;
    const captionTask = wantsCaptions && (status !== 1 || this.now - this.historyPollAt >= 15) ? this.syncTranscripts(course, gen) : Promise.resolve();
    let captionAddress = info.content?.trans_socket_url || this.liveAddress;
    if (wantsCaptions && status === 1 && !captionAddress) { try { captionAddress = await this.api.liveCaptionAddress(course, info); } catch (err) { if (err instanceof AccessDenied) throw err; } }
    if (gen !== this.generation) return;
    if (wantsCaptions && status === 1 && captionAddress) {
      const address = captionAddress;
      if (address !== this.liveAddress) {
        this.liveAddress = address;
        this.live.connect(address, course.start, (line: Transcript) => {
          if (gen !== this.generation || !(this.transcription || this.skipEmpty || this.smartSkip || this.aiOpen || this.summaryOpen) || !this.foreground) return;
          this.now = Date.now() / 1000; const next = mergeLines(this.lines, [line]); if (JSON.stringify(next) !== JSON.stringify(this.lines)) { this.lines = next; this.transcriptState = ''; this.rebuildGroups(); this.prepareImages(gen); }
        }, (state: string) => { if (gen === this.generation) { this.liveCaptionState = state; this.transcriptState = this.lines.length ? '' : state; } });
      }
    } else { this.live.close(); this.liveAddress = ''; }
    try {
      let incoming = await this.api.slides(course);
      if (!incoming.length && info.resource_id) incoming = await this.api.resourceSlides(String(info.resource_id));
      if (gen !== this.generation) return;
      const firstLoad = this.initialPosition;
      if (firstLoad) this.following = status === 1;
      const next = mergeSlides(this.slides, incoming);
      if (JSON.stringify(this.slides) !== JSON.stringify(next)) { const changed = this.slides.filter((old: Slide) => next.some((page: Slide) => page.id === old.id && page.url !== old.url)).map((page: Slide) => page.id); if (changed.length) { this.imageRevision++; const uris: Record<string, string> = {}; Object.keys(this.imageUris).filter((id: string) => !changed.includes(id)).forEach((id: string) => uris[id] = this.imageUris[id]); this.imageUris = uris; this.imageQueue = []; } this.slides = next; }
      this.rebuildGroups(firstLoad);
      this.prepareImages(gen);
      if (this.slides.length) this.initialPosition = false;
    } finally { await captionTask; }
    if (gen !== this.generation) return;
    this.updateMissingPanes(); await this.restoreProgress();
    if (gen === this.generation && this.preferredVideo && !this.showVideo && !this.videoBusy) await this.toggleVideo();
    if (gen !== this.generation) return;
    this.message = '';
    this.syncState = status === 1 ? `直播中 · ${this.groups.length} 页` : `历史课堂 · ${this.groups.length} 页`;
    this.store?.save({ course, slides: this.slides, lines: this.lines, savedAt: Date.now() });
    this.saveProgress(); this.prepareImages(gen);

    if (status !== 1) {
      // Recorded classes are immutable while viewed; explicit refresh is available.
      this.syncState = `历史课堂 · ${this.groups.length} 页`;
    }
  }
  private async syncTranscripts(course: Course, gen: number): Promise<void> {
    this.historyPollAt = this.now;
    if (this.smartSkip && !this.historyReady) this.skipPreparing = true;
    if (!this.lines.length) this.transcriptState = '正在同步转写…';
    try {
      const lines = await this.api.transcripts(course);
      if (gen !== this.generation) return;
      this.historyReady = true;
      this.historicalCaptionMissing = Number(this.info?.sub_status) === 1 && !lines.length;
      const next = reconcileLines(this.lines, lines);
      if (JSON.stringify(next) !== JSON.stringify(this.lines)) this.lines = next;
      this.transcriptState = this.lines.length ? '' : Number(this.info?.sub_status) === 1 ? (this.liveAddress ? (this.liveCaptionState || '正在连接实时转写') : '平台尚未提供实时转写') : '暂无转写';
      this.rebuildGroups(); this.prepareImages(gen);
    } catch (err) { if (gen === this.generation) this.transcriptState = this.lines.length ? '' : Number(this.info?.sub_status) === 1 && this.liveAddress ? (this.liveCaptionState || '正在连接实时转写') : (err as Error).message; }
    finally { if (gen === this.generation) this.skipPreparing = false; }
  }
  private rebuildGroups(firstLoad: boolean = false): void {
    const old = this.groups.map((g: PageGroup) => g.slide);
    const live = Number(this.info?.sub_status) === 1;
    const options = String(this.mergeDuplicateSlides) + ':' + this.smartSkip + ':' + this.skipSparse;
    const changed = this.groupedSlides !== this.slides || this.groupedLines !== this.lines || this.groupedRanges !== this.skipRanges || this.groupedOptions !== options;
    if (changed) {
      this.rawGroups = groupPages(this.slides, this.lines, this.mergeDuplicateSlides);
      const clean = this.cleanTranscript();
      this.groups = (clean === this.lines ? this.rawGroups : groupPages(this.slides, clean, this.mergeDuplicateSlides)).map((group: PageGroup, i: number): PageGroup => { return { slide: group.slide, lines: group.lines, skipContent: this.smartSkip && this.skipSparse ? group.lines.some((line: Transcript) => !fillerOnly(line.text)) : this.rawGroups[i].lines.length > 0 }; });
      this.groupedSlides = this.slides; this.groupedLines = this.lines; this.groupedRanges = this.skipRanges; this.groupedOptions = options;
    }
    const raw = this.rawGroups, next = this.groups;
    const index = firstLoad ? (live ? next.length - 1 : 0) : selectedAfterUpdate(old, next.map((g: PageGroup) => g.slide), this.selected, this.following && live && (!this.showVideo || !this.followVideo));
    this.selected = firstLoad || (this.following && live && (!this.showVideo || !this.followVideo)) ? spreadStart(index, this.capacity) : Math.max(0, index);
    if (this.showVideo && this.followVideo) this.followPlayback();
    if (this.smartSkip && this.foreground && this.screen === 'lesson' && this.course && this.store) {
      const courseId = this.course.subId;
      if (live || this.historyReady || this.offlineViewing || this.demo) this.smartFilter.update(this.store, this.course, raw, live ? Math.max(0, this.now - this.course.start) : this.videoEnd || Math.max(this.course.end - this.course.start, ...this.lines.map((line: Transcript) => line.end || line.t)), live, this.historicalCaptionMissing, this.selected, (ranges: SkipRange[], message: string) => {
        if (!this.smartSkip || this.course?.subId !== courseId || this.screen !== 'lesson') return; this.skipStatus = message;
        const signature = JSON.stringify(ranges); if (signature !== this.smartRangesKey) { this.smartRangesKey = signature; this.skipRanges = ranges; this.rebuildGroups(); }
      }, (progress: SkipProgress) => this.skipProgressChanged(courseId, progress), this.lines);
    }
    if (this.skipNoMatchPending && !this.skipPreparing && !this.skipProgress.running && (this.historyReady || this.offlineViewing || this.demo)) this.reportNoSkipPages();
  }
  private skipOpeningPages(): void {
    if (!this.skipEmpty || Number(this.info?.sub_status) === 1 || !(this.historyReady || this.offlineViewing || this.demo) || !this.groups.length) return;
    const current = this.groups[this.selected]; if (current && (current.skipContent ?? current.lines.length > 0)) return;
    const next = this.groups.findIndex((group: PageGroup, index: number) => index >= this.selected && (group.skipContent ?? group.lines.length > 0));
    if (next >= 0) { this.selected = next; this.prepareImages(this.generation); }
  }
  private async toggleSkipEmpty(): Promise<void> {
    if (this.smartSkip) {
      const gen = this.generation, subId = this.course?.subId;
      let picked: promptAction.ActionMenuSuccessResponse; try { picked = await this.getUIContext().getPromptAction().showActionMenu({ title: '跳过无转写页面 · 选择模式', buttons: [{ text: '关闭跳过', color: '#425F7D' }, { text: '仅跳过完全无转写的课件', color: '#168BEE' }, { text: '也跳过仅有杂音等无效转写的课件', color: '#168BEE' }] }); } catch (_) { return; }
      if (gen !== this.generation || subId !== this.course?.subId || !this.smartSkip) return;
      this.skipEmpty = picked.index > 0; this.skipSparse = picked.index === 2; this.store?.saveJson('smart-skip-sparse.txt', String(this.skipSparse));
    } else this.skipEmpty = !this.skipEmpty;
    try { this.store?.savePageOptions(false, this.skipEmpty); } catch (_) {}
    this.skipNoMatchPending = this.skipEmpty; this.resize(); this.rebuildGroups(); this.skipOpeningPages(); this.reconcileChosenPages();
    if (this.skipEmpty && !this.historyReady && !this.demo && !this.offlineViewing) this.resume();
  }
  private reportNoSkipPages(): void {
    this.skipNoMatchPending = false;
    if (this.skipEmpty && this.groups.length && !this.groups.some((group: PageGroup) => !(group.skipContent ?? group.lines.length > 0))) this.getUIContext().getPromptAction().showToast({ message: this.smartSkip && this.skipSparse ? '未发现无转写或仅含杂音的课件' : '未发现无转写课件', duration: 2200 });
  }
  private skipProgressChanged(courseId: string, progress: SkipProgress): void {
    if (!this.smartSkip || this.course?.subId !== courseId || this.screen !== 'lesson') return;
    if (JSON.stringify(this.skipProgress) !== JSON.stringify(progress)) this.skipProgress = progress;
    if (!progress.running && progress.total > 0 && !this.skipModePrompted) { this.skipModePrompted = true; if (this.skipEmpty) this.toggleSkipEmpty(); }
  }
  private smartSkipConfiguring: boolean = false;
  private async toggleSmartSkip(): Promise<void> {
    if (this.smartSkipConfiguring) return; this.smartSkipConfiguring = true;
    try {
    if (!this.smartSkip && !await AiClient.savedKey()) { this.getUIContext().getPromptAction().showToast({ message: '请先在课程问答中设置 API 密钥', duration: 2200 }); return; }
    const gen = this.generation;
    if (!this.smartSkip) {
      try { const picked = await this.getUIContext().getPromptAction().showDialog({ title: '开启跳过无效内容？', message: '此功能会逐页分析转写和课件，长课次可能消耗较多 Token，并产生 API 费用。已有识别缓存会复用；不确定的内容保留。本功能默认关闭。', buttons: [{ text: '取消', color: '#71839A' }, { text: '开启', color: '#168BEE' }] }); if (picked.index !== 1 || gen !== this.generation || this.screen !== 'lesson') return; } catch (_) { return; }
    }
    this.smartSkip = !this.smartSkip; this.store?.saveJson('smart-skip-enabled.txt', 'false');
    this.smartFilter.cancel(); this.skipModePrompted = false; this.skipNoMatchPending = false; this.skipProgress = { completed: 0, total: 0, failed: 0, running: false }; this.skipRanges = []; this.smartRangesKey = ''; this.skipStatus = ''; this.lastAutomaticRange = ''; this.skipPreparing = this.smartSkip && !this.historyReady && !this.demo && !this.offlineViewing; this.rebuildGroups(); if (this.skipPreparing) this.resume();
    } finally { this.smartSkipConfiguring = false; }
  }

  private transcriptGroups: PageGroup[] | undefined = undefined;
  private transcriptLines: Transcript[] | undefined = undefined;
  private transcriptSelected: number = -1;
  private transcriptCapacity: number = -1;
  private renderedSlideSource: Slide[] | undefined = undefined;
  private renderedSlides: Slide[] = [];
  private cleanLineSource: Transcript[] | undefined = undefined;
  private cleanRangeSource: SkipRange[] | undefined = undefined;
  private cleanLines: Transcript[] = [];
  private visibleGroupSource: PageGroup[] | undefined = undefined;
  private visibleGroupOptions: string = '';
  private cachedVisibleGroups: PageGroup[] = [];
  private cleanTranscript(): Transcript[] {
    if (!this.smartSkip) return this.lines;
    if (this.cleanLineSource !== this.lines || this.cleanRangeSource !== this.skipRanges) { this.cleanLineSource = this.lines; this.cleanRangeSource = this.skipRanges; this.cleanLines = filteredTranscript(this.lines, this.skipRanges); }
    return this.cleanLines;
  }
  private transcriptMode: string = '';
  private transcriptVisible: Transcript[] = [];
  private manualBrowsing(): boolean { return !this.following && (!this.showVideo || !this.followVideo); }
  private visibleGroups(): PageGroup[] {
    const options = this.selected + ':' + this.capacity + ':' + this.skipEmpty + ':' + this.manualBrowsing();
    if (this.visibleGroupSource !== this.groups || this.visibleGroupOptions !== options) { this.visibleGroupSource = this.groups; this.visibleGroupOptions = options; this.cachedVisibleGroups = displayedGroups(this.groups, this.selected, this.capacity, this.skipEmpty, this.manualBrowsing()); }
    return this.cachedVisibleGroups;
  }
  private emptyTranscriptState(): string {
    if (this.historicalCaptionMissing && this.selected < this.groups.length - 1 && !this.displayedTranscript().length) return '平台暂未提供直播历史转写，无法补齐进入前的内容。';
    return this.transcriptState;
  }
  private continuousTranscript(): boolean { return !this.slides.length || !(this.slidesEnabled || this.summaryOpen); }
  private displayedTranscript(): Transcript[] {
    if (this.continuousTranscript()) return this.cleanTranscript();
    const mode = this.skipEmpty + ':' + this.manualBrowsing();
    if (this.transcriptGroups !== this.groups || this.transcriptLines !== this.lines || this.transcriptSelected !== this.selected || this.transcriptCapacity !== this.capacity || this.transcriptMode !== mode) {
      this.transcriptGroups = this.groups; this.transcriptLines = this.lines; this.transcriptSelected = this.selected; this.transcriptCapacity = this.capacity;
      this.transcriptMode = mode;
      this.transcriptVisible = this.groups.length ? this.visibleGroups().reduce((all: Transcript[], group: PageGroup) => all.concat(group.lines), [] as Transcript[]) : this.lines;
    }
    return this.transcriptVisible;
  }
  private turnPages(direction: number, count: number = this.capacity, owner: string = this.activePane): void {
    const next = manualPage(this.groups, this.selected, count, direction, this.skipEmpty);
    if (next === this.selected) this.skipHint(direction);
    this.selected = next; this.transcriptReadingAt = this.groups[next]?.slide.t ?? -1; this.transcriptReadingOffset = 0;
    this.browsed(owner); if (owner === 'transcript' && this.continuousTranscript()) this.transcriptScrollSequence++;
    this.prepareImages(this.generation);
  }
  private skipHint(direction: number): void {
    if (this.skipEmpty && direction < 0 && this.selected > 0 && !this.groups.slice(0, this.selected).some((group: PageGroup) => group.lines.length)) this.getUIContext().getPromptAction().showToast({ message: '前页无转写，如需查看请关闭“跳过无转写页面”', duration: 2500 });
  }
  private lessonDuration(): number {
    if (Number(this.info?.sub_status) === 1) return Math.max(0, Date.now() / 1000 - (this.course?.start || Date.now() / 1000));
    if (this.videoEnd > 0) return this.videoEnd;
    return Math.max(0, this.course ? this.course.end - this.course.start : 0, this.slides[this.slides.length - 1]?.t || 0, this.lines[this.lines.length - 1]?.end || 0);
  }
  private pageLabel(): string {
    const pages = this.visibleGroups().map((g: PageGroup) => this.presentationSlides().findIndex((s: Slide) => s.id === g.slide.id) + 1);
    return pages.length ? pages.join('、') + ' / ' + this.groups.length + ' 页' : '课件正在同步';
  }
  private async enter(course: Course, reference?: CourseJump, noteId: string = ''): Promise<void> {
    this.entryPaused = !!noteId; this.requestedNoteId = noteId;
    if (!reference) this.courseReturnStack = []; this.pendingCourseJump = reference;
    this.trimBorders = true; this.resize();
    this.closeMedia(); this.offlineViewing = false; this.offlineReturn = false; this.offlineOpen = false;
    this.stop(); this.selectingPane = ''; this.smartSkip = false; this.skipRanges = []; this.smartRangesKey = ''; this.skipStatus = ''; this.lastAutomaticRange = ''; this.permissionAt = 0; this.initialPosition = true; this.historyReady = false; this.historicalCaptionMissing = false; this.historyPollAt = 0; this.info = undefined; this.activePane = 'slides'; this.editingPane = ''; this.course = course; this.collections.catalogue(course as CollectionCourse, [course]); this.store?.useCourse(course); this.loadProgress(course); this.demo = false; this.message = ''; this.transcriptState = '';
    this.selected = 0; this.following = true; this.imageUris = {}; this.slides = []; this.lines = []; this.groups = []; this.missingPanes = []; this.preferenceProfile = ''; this.applyPaneChoices();
    const snapshot = this.store?.load(course.subId);
    if (snapshot) {
      this.slides = snapshot.slides; this.lines = snapshot.lines; this.groups = groupPages(this.slides, this.lines, this.mergeDuplicateSlides);
      this.selected = 0; this.syncState = '正在同步';
    }
    this.screen = 'waiting';
    this.tick();
  }
  private async openManagedNote(note: LessonNote): Promise<void> {
    const id = note.id || 'default';
    const saved = this.library?.entry(note.course.subId);
    if (saved) this.openOffline(saved, undefined, id);
    else await this.enter(note.course, undefined, id);
    if (this.course?.subId !== note.course.subId) return;
    this.entryPaused = true; this.requestedNoteId = id; this.notesCreated = true; this.notesOpen = true; this.resize(); this.focusPane('notes');
  }
  private home(): void {
    this.courseReturnStack = []; this.pendingCourseJump = undefined;
    this.now = Date.now() / 1000;
    this.courses = this.courses.slice(); this.coursePermissions = this.api.cachedPermissions(this.courses);
    this.closeMedia(); this.offlineViewing = false; this.offlineOpen = this.offlineReturn; this.offlineReturn = false;
    this.stop(); this.demo = false; this.screen = 'home'; this.course = undefined; this.slides = []; this.groups = []; this.lines = []; this.imageUris = {}; this.message = ''; this.catalogAt = 0; this.forcePermissionRefresh = true; this.tick();
  }
  private async logout(): Promise<void> {
    this.closeMedia(); this.library?.pause(); this.offlineViewing = false; this.offlineOpen = false;
    this.stop(); webview.WebCookieManager.clearAllCookiesSync(); await SessionStore.clear();
    this.api.usePermissionStorage(undefined); this.trimBorders = false;
    this.coursePermissions = {}; this.plaza = false; this.allCoursesOpen = false; this.collectionPage = ''; this.collections.bind(undefined); this.account = undefined; this.course = undefined; this.store = undefined; this.courses = []; this.slides = []; this.lines = []; this.groups = []; this.imageUris = {};
    this.offlineEntries = []; this.downloadJobs = []; this.library = undefined; this.notesLibrary = false; this.cacheSettings = false; this.downloadsOpen = false; this.lessonDownloadOpen = false; this.collectionPage = ''; this.courseReturnStack = []; this.pendingCourseJump = undefined; this.authOfficial = false; this.authSubmitting = false; this.authSubmitted = false; this.authPassword = ''; clearTimeout(this.authTimer); clearTimeout(this.authRetry);
    this.demo = false; this.screen = 'home'; this.message = '';
  }
  private toggleTranscription(): void {
    if (this.unavailablePane('transcript')) return;
    this.transcription = !this.transcription; this.resize(); this.rebuildGroups();
    if (!this.demo) { try { this.store?.saveTranscription(this.transcription); } catch (_) {} }
    if (!this.demo && !this.offlineViewing) this.resume();
  }
  private toggleSlides(): void {
    if (this.unavailablePane('slides')) return;
    this.slidesEnabled = !this.slidesEnabled;
    if (!this.slidesEnabled) this.overview = false;
    this.resize();
    if (!this.demo) { try { this.store?.saveSlides(this.slidesEnabled); } catch (_) {} }
  }
  private toggleBorders(): void {
    this.trimBorders = !this.trimBorders; this.imageRevision++;
    try { this.store?.saveTrimBorders(this.trimBorders); } catch (_) {}
    if (!this.demo) { this.imageUris = {}; this.prepareImages(this.generation); }
  }
  private activePanes(): string[] {
    const ids: string[] = [];
    if (this.showVideo && this.videoSource) ids.push('video');
    if (this.slidesEnabled) ids.push('slides');
    if (this.transcription) ids.push('transcript');
    if (this.notesOpen) ids.push('notes');
    if (this.aiOpen) ids.push('ai');
    if (this.summaryOpen) ids.push('summary');
    return ids;
  }
  private updateLayout(): void {
    if (this.videoFullscreen) return;
    const ids = this.activePanes(), key = layoutKey(ids, this.windowWidth, this.windowHeight);
    if (key === this.layoutContext) return;
    this.layoutContext = key; this.editingPane = ''; this.layoutLocked = this.layoutLocked || !!this.savedLayoutLocks[key];
    const saved = matchingLayout(this.savedLayouts[key] || [], ids);
    this.paneRects = saved.length ? saved : defaultPanes(ids, this.windowWidth < 600);
  }

  private pane(id: string): PaneRect { return this.paneRects.find((rect: PaneRect) => rect.id === id) || { id, x: 0, y: 0, w: 1, h: 1, z: 0 }; }
  private canvasHeight(): number { return this.videoFullscreen ? this.workspaceHeight : this.windowWidth < 600 ? Math.max(this.workspaceHeight, this.activePanes().length * 340) : this.workspaceHeight; }
  private paneWidth(id: string): number { return this.videoFullscreen && id === 'video' ? this.workspaceWidth : Math.max(1, this.pane(id).w * this.workspaceWidth - 8); }
  private paneHeight(id: string): number { return this.videoFullscreen && id === 'video' ? this.workspaceHeight : Math.max(1, this.pane(id).h * this.canvasHeight() - 8); }
  private paneX(id: string): number { return this.videoFullscreen && id === 'video' ? 0 : this.pane(id).x * this.workspaceWidth + 4; }
  private paneY(id: string): number { return this.videoFullscreen && id === 'video' ? 0 : this.pane(id).y * this.canvasHeight() + 4; }
  private paneFront(id: string): boolean { return this.paneRects.slice().sort((a: PaneRect, b: PaneRect) => b.z - a.z)[0]?.id === id; }
  @State activePane: string = 'slides';
  private activatePane(id: string): void {
    NativeSelections.clearExcept(id);
    this.activePane = id;
    if (this.editingPane && this.editingPane !== id) this.editingPane = ''; if (!this.videoFullscreen && !this.paneFront(id)) this.paneRects = reorderPanes(this.paneRects, id, 'top'); }
  private setPane(rect: PaneRect): void {
    if (this.layoutLocked) return;
    const value = normalizePane(rect);
    const previous = this.pane(value.id);
    if (previous.x === value.x && previous.y === value.y && previous.w === value.w && previous.h === value.h && this.paneFront(value.id)) return;
    const replaced = this.paneRects.filter((item: PaneRect) => item.id !== value.id).concat([value]);
    this.paneRects = reorderPanes(replaced, value.id, 'top');
    if (previous.w !== value.w || previous.h !== value.h) this.resize();
  }
  private layoutPreset(preset: string): void {
    if (this.layoutLocked) return;
    this.paneRects = defaultPanes(this.activePanes(), this.windowWidth < 600 && preset === 'auto', preset);
    this.resize();
  }
  private saveLayout(): void {
    const key = layoutKey(this.activePanes(), this.windowWidth, this.windowHeight);
    this.savedLayouts[key] = this.paneRects.map((rect: PaneRect): PaneRect => { return { id: rect.id, x: rect.x, y: rect.y, w: rect.w, h: rect.h, z: rect.z }; });
    this.savedLayoutLocks[key] = this.layoutLocked;
    try { this.store?.saveJson('pane-layout-v2.json', JSON.stringify({ profiles: this.savedLayouts, locks: this.savedLayoutLocks } as SavedPaneLayouts)); this.layoutOpen = false; } catch (_) { this.message = '布局未能保存，请重试'; }
  }
  private focusPane(id: string): void { this.activatePane(id); if (this.windowWidth < 600) setTimeout((): void => { this.workspaceScroller.scrollTo({ xOffset: 0, yOffset: this.paneY(id), animation: { duration: 180 } }); }, 40); }
  private resize(): void {
    this.updateLayout();
    const count = this.activePanes().length === 1 && this.slidesEnabled && this.slideCount > 0 ? this.slideCount : this.slidesEnabled ? pageCapacity(this.paneWidth('slides'), this.paneHeight('slides'), this.screenWidth, this.screenHeight, false) : 1;
    if (count !== this.capacity) { this.capacity = count; this.selected = spreadStart(this.selected, count); }
  }
  private similarity: SlideSimilarityStore = new SlideSimilarityStore();
  private comparingSlides: boolean = false;
  private compareAgain: boolean = false;
  private presentationSlides(): Slide[] {
    if (!this.mergeDuplicateSlides) return this.slides;
    if (this.renderedSlideSource !== this.slides) { this.renderedSlideSource = this.slides; this.renderedSlides = distinctSlides(this.slides); }
    return this.renderedSlides;
  }
  private reconcileChosenPages(): void { const visible = visiblePageGroups(this.groups, this.skipEmpty, Number(this.info?.sub_status) === 1), ids: string[] = []; this.aiSelectedIds.forEach((id: string) => { const raw = this.slides.find((slide: Slide) => slide.id === id), page = this.groups.find((group: PageGroup) => group.slide.id === id) || (raw ? this.groups.find((group: PageGroup, index: number) => group.slide.t <= raw.t && raw.t < (this.groups[index + 1]?.slide.t ?? Infinity)) : undefined); if (page && visible.some((group: PageGroup) => group.slide.id === page.slide.id) && !ids.includes(page.slide.id)) ids.push(page.slide.id); }); this.aiSelectedIds = ids; }
  private toggleDuplicateSlides(): void { this.mergeDuplicateSlides = !this.mergeDuplicateSlides; this.store?.saveJson('merge-duplicate-slides.txt', String(this.mergeDuplicateSlides)); this.rebuildGroups(); this.reconcileChosenPages(); this.prepareImages(this.generation); if (this.mergeDuplicateSlides) this.reconcileSlideDuplicates(this.generation); }
  private async reconcileSlideDuplicates(gen: number): Promise<void> {
    if (!this.mergeDuplicateSlides) return;
    if (this.comparingSlides) { this.compareAgain = true; return; }
    this.comparingSlides = true;
    try {
      do {
        this.compareAgain = false; const revision = this.imageRevision, source = this.slides.slice(); let anchor = source[0];
        for (let i = 1; i < source.length; i++) {
          const current = source[i], previous = source[i - 1];
          if (!anchor) { anchor = current; continue; }
          let first = this.store?.cachedImage(anchor.url), second = this.store?.cachedImage(current.url);
          const store = this.store, course = this.course;
          if ((!first || !second) && store && course && !this.offlineViewing && this.foreground) {
            try { if (!first) first = await store.image(anchor.url, () => {}, course); if (gen !== this.generation || !this.mergeDuplicateSlides || !this.foreground) return; if (!second) second = await store.image(current.url, () => {}, course); } catch (_) {}
          }
          if (gen !== this.generation || !this.foreground || !this.mergeDuplicateSlides) return;
          if (!first || !second) { anchor = current; continue; }
          const equal = await this.similarity.same(first, second);
          if (gen !== this.generation || revision !== this.imageRevision) return;
          const present = this.slides.find((slide: Slide) => slide.id === current.id && slide.url === current.url);
          if (!present) continue;
          if (equal) {
            if (present.duplicateOf !== previous.id || present.duplicateUrl !== previous.url) {
              this.slides = this.slides.map((slide: Slide): Slide => slide.id === current.id ? { id: slide.id, t: slide.t, url: slide.url, thumb: slide.thumb, note: slide.note, duplicateOf: previous.id, duplicateUrl: previous.url } : slide);
              this.aiSelectedIds = Array.from(new Set(this.aiSelectedIds.map((id: string) => id === current.id ? anchor.id : id)));
              this.rebuildGroups();
            }
          } else {
            if (present.duplicateOf) { this.slides = this.slides.map((slide: Slide): Slide => slide.id === current.id ? { id: slide.id, t: slide.t, url: slide.url, thumb: slide.thumb, note: slide.note } : slide); this.rebuildGroups(); }
            anchor = current;
          }
        }
      } while (this.compareAgain && gen === this.generation);
      if (this.course && gen === this.generation && !this.offlineViewing) this.store?.save({ course: this.course, slides: this.slides, lines: this.lines, savedAt: Date.now() });
    } finally { this.comparingSlides = false; if (this.compareAgain && this.screen === 'lesson') { this.compareAgain = false; this.reconcileSlideDuplicates(this.generation); } }
  }
  private async prepareImages(gen: number, position: number = this.selected): Promise<void> {
    if (!this.store || !this.foreground) return;
    const store = this.store, revision = this.imageRevision, trim = this.trimBorders;
    const start = Math.max(0, position - this.capacity);
    const end = Math.min(this.groups.length, position + this.capacity * 2);
    const requested = this.groups.slice(start, end).concat(displayedGroups(this.groups, position, this.capacity * 2, this.skipEmpty, this.manualBrowsing()));
    for (const group of requested) {
      const s = group.slide;
      if (this.imageUris[s.id]) continue;
      try {
        const uri = trim ? await store.trimmedImage(s.url) : await store.image(s.url);
        if (gen !== this.generation || revision !== this.imageRevision) return;
        const uris: Record<string, string> = {};
        Object.keys(this.imageUris).forEach((k: string) => { uris[k] = this.imageUris[k]; });
        uris[s.id] = uri; this.imageUris = uris; this.reconcileSlideDuplicates(gen);
      } catch (_) { if (gen === this.generation) this.message = '部分图片未下载成功，将自动重试'; }
    }
  }
  private visibleCourses(): Course[] {
    const today = shanghaiDate(this.now);
    return this.recent ? this.courses.filter((c: Course) => c.end < this.now).slice().reverse() : this.courses.filter((c: Course) => shanghaiDate(c.start) === today);
  }
  private latestSlide(): void {
    this.clearStudyReturn();
    if (this.showVideo && Number(this.info?.sub_status) === 1) this.resumeLive();
    this.following = true; this.followVideo = this.showVideo; this.followTranscript = true;
    this.selected = spreadStart(this.groups.length - 1, this.capacity); this.prepareImages(this.generation);
  }
  private returnToLatest(): void {
    this.clearStudyReturn();
    this.followTranscript = true;
    if (this.showVideo) { this.following = false; this.followVideo = true; this.followPlayback(); return; }
    this.following = true; this.selected = spreadStart(this.groups.length - 1, this.capacity); this.prepareImages(this.generation);
  }
  private jumpToTime(seconds: number): void {
    seconds = Math.max(0, Math.min(this.lessonDuration(), seconds));
    if (this.showVideo && Number(this.info?.sub_status) === 1 && !this.liveReplay) { this.beginReplay().then((allowed: boolean) => { if (allowed) setTimeout(() => this.jumpToTime(seconds), 32); }); return; }
    this.followTranscript = true; this.textStudyTime = seconds;
    if (this.showVideo) { this.playback.seek(seconds); this.followVideo = true; this.videoTime = seconds; this.followPlayback(); this.saveProgress(true); return; }
    let index = 0;
    this.groups.forEach((g: PageGroup, i: number) => { if (g.slide.t <= seconds) index = i; });
    this.selected = Math.min(index, spreadStart(this.groups.length - 1, this.capacity));
    this.following = false; this.prepareImages(this.generation); this.saveProgress(true);
  }
  private closeMedia(): void {
    NativeSelections.clear(); this.clearStudyReturn(); this.transcriptReadingAt = -1; this.transcriptReadingOffset = 0;
    if (this.jumpingDialogOpen) { this.jumpDialog.close(); this.pageDialog.close(); this.jumpingDialogOpen = false; }
    this.saveProgress(true); this.progressReady = false; this.pendingProgress = undefined;
    this.focusedEditors.clear(); this.inputFocused = false;
    this.store?.cache.flush(); this.store?.releaseTemporary();
    this.noteContentReference = undefined; this.summaryResume = undefined; this.layoutContext = ''; this.editingPane = ''; this.layoutOpen = false; this.expandedSlideId = '';
    this.smartSkip = false; this.smartFilter.cancel(); this.cancelCameraProbe(); this.cameraCandidates = []; this.fullscreen(false); this.playback.pause(); this.showVideo = false; this.videoBusy = false; this.videoSource = undefined; this.videoSources = []; this.videoTime = 0; this.liveReplay = false; this.videoSeekable = false; this.videoEnd = 0; this.replaySources = [];
    this.followVideo = true; this.followTranscript = true; this.overview = false; this.slideFullscreen = false; this.aiOpen = false; this.aiCreated = false; this.summaryOpen = false; this.summaryCreated = false; this.aiPagePicker = false; this.aiSelectedIds = []; this.settingsCustomizeOpen = false; this.notesOpen = false; this.notesCreated = false; this.highlightAt = -1; this.imageHighlightId = ''; clearTimeout(this.highlightTimer); this.offlineItem = undefined; this.imageQueue = [];
    this.resize();
  }
  private stopGravity(): void {
    if (!this.gravityListening) return;
    try { sensor.off(sensor.SensorId.GRAVITY, this.gravityCallback); } catch (_) {}
    this.gravityListening = false; this.gravityCandidate = '';
  }
  private rotationWatch(): void {
    if (deviceInfo.deviceType !== 'phone' || !this.showVideo || !this.foreground) { this.stopGravity(); return; }
    if (this.gravityListening) return;
    this.gravityDirection = 'portrait'; this.gravitySuppressed = false; this.gravityCandidate = '';
    try { sensor.on(sensor.SensorId.GRAVITY, this.gravityCallback, { interval: 200000000 }); this.gravityListening = true; } catch (_) {}
  }
  private fullscreen(value: boolean, fromGravity: boolean = false): void {
    if (!value && !fromGravity && this.gravityDirection === 'landscape') this.gravitySuppressed = true;
    if (value === this.videoFullscreen) return;
    this.videoFullscreen = value;
    if (value) this.workspaceScroller.scrollTo({ xOffset: 0, yOffset: 0 });
    window.getLastWindow(this.getUIContext().getHostContext()).then(async (win: window.Window) => {
      if (deviceInfo.deviceType === 'phone') {
        if (value) { this.savedOrientation = win.getPreferredOrientation(); await win.setPreferredOrientation(window.Orientation.AUTO_ROTATION_LANDSCAPE); }
        else await win.setPreferredOrientation(fromGravity ? window.Orientation.PORTRAIT : this.savedOrientation);
      }
      await win.setWindowSystemBarEnable(value ? [] : ['status', 'navigation']);
    }).catch(() => {});
  }
  private panePreferences: PanePreferences = { regular: defaultPaneChoices(), missing: {} };
  private missingPanes: string[] = [];
  private preferenceProfile: string = '';
  private preferredVideo: boolean = false;
  private currentPaneChoices(): PaneChoices { return { slides: this.slidesEnabled, transcript: this.transcription, video: this.showVideo, notes: this.notesOpen, ai: this.aiOpen, summary: this.summaryOpen }; }
  private savePaneChoices(): void { if (!this.course || this.demo) return; this.panePreferences = rememberPaneChoices(this.panePreferences, this.currentPaneChoices(), this.missingPanes); this.store?.saveJson('pane-choices-v1.json', JSON.stringify(this.panePreferences)); }
  private applyPaneChoices(): void { const choice = chosenPanes(this.panePreferences, this.missingPanes); this.preferredVideo = choice.video; if (!choice.video && this.showVideo) { this.playback.pause(); this.showVideo = false; this.fullscreen(false); } this.slidesEnabled = choice.slides; this.transcription = choice.transcript; this.notesOpen = choice.notes; this.notesCreated = this.notesCreated || choice.notes; this.aiOpen = choice.ai; this.aiCreated = this.aiCreated || choice.ai; this.summaryOpen = choice.summary; this.summaryCreated = this.summaryCreated || choice.summary; this.resize(); }
  private unavailablePane(id: string): boolean { if (!this.missingPanes.includes(id)) return false; this.getUIContext().getPromptAction().showToast({ message: '这节课' + (this.offlineViewing ? '未保存' : '平台未提供') + this.featureName(id), duration: 2200 }); return true; }
  private updateMissingPanes(): void { if (Number(this.info?.sub_status) !== 6) return; const missing = [!this.slides.length ? 'slides' : '', this.historyReady && !this.lines.length ? 'transcript' : '', this.missingPanes.includes('video') ? 'video' : ''].filter((id: string) => !!id); const profile = missingPaneKey(missing); this.missingPanes = missing; if (profile !== this.preferenceProfile) { this.preferenceProfile = profile; this.applyPaneChoices(); }  }
  private featureName(id: string): string {
    const labels: string[] = ['课件', '转写', '视频', '概览', '笔记', '课程问答', '本页速览', '布局', '去黑边', '合并重复课件', '跳过无转写', '跳过无效内容', '回到最新', '跳转时间', '跳转页数', '下载课程'];
    return (labels[this.featureIds.indexOf(id)] || id) + (id === 'skip' && this.smartSkip ? ' ▾' : '');
  }
  private featureChecked(id: string): boolean { return id === 'slides' ? this.slidesEnabled : id === 'transcript' ? this.transcription : id === 'video' ? this.showVideo : id === 'overview' ? this.overview : id === 'notes' ? this.notesOpen : id === 'ai' ? this.aiOpen : id === 'summary' ? this.summaryOpen : id === 'layout' ? this.layoutOpen : id === 'borders' ? this.trimBorders : id === 'merge' ? this.mergeDuplicateSlides : id === 'skip' ? this.skipEmpty : id === 'smartSkip' ? this.smartSkip : false; }
  private featureAction(id: string): void {
    if (['overview', 'time', 'page', 'layout', 'download'].includes(id)) NativeSelections.clear();
    if (['overview', 'time', 'page', 'download'].includes(id)) this.layoutOpen = false;
    if (id === 'slides') this.toggleSlides(); else if (id === 'transcript') this.toggleTranscription(); else if (id === 'video') { if (this.unavailablePane('video')) return; const gen = this.generation, subId = this.course?.subId; this.toggleVideo().then(() => { if (gen !== this.generation || subId !== this.course?.subId) return; this.preferredVideo = this.showVideo; if (!this.missingPanes.includes('video')) this.savePaneChoices(); }); return; }
    else if (id === 'overview') { this.slideFullscreen = false; if (this.videoFullscreen) this.fullscreen(false); this.aiPagePicker = false; this.overview = !this.overview; } else if (id === 'notes') this.openNotes(); else if (id === 'ai') this.openAi();
    else if (id === 'summary') { if (!this.privacyAccepted) { this.privacyOpen = true; return; } this.summaryCreated = true; this.summaryOpen = !this.summaryOpen; if (!this.summaryOpen) this.editorFocus('summary', false); this.resize(); if (this.summaryOpen) this.focusPane('summary'); }
    else if (id === 'layout') this.layoutOpen = !this.layoutOpen; else if (id === 'borders') this.toggleBorders(); else if (id === 'merge') this.toggleDuplicateSlides(); else if (id === 'skip') this.toggleSkipEmpty(); else if (id === 'smartSkip') this.toggleSmartSkip();
    else if (id === 'latest') this.latestSlide(); else if (id === 'time' || id === 'page') { this.overview = false; this.aiPagePicker = false; if (id === 'time') this.jumpDialog.open(); else this.pageDialog.open(); }
    else if (id === 'download' && this.course) this.openDownload([this.course]);
    if (['slides', 'transcript', 'video', 'notes', 'ai', 'summary'].includes(id) && !this.missingPanes.includes(id)) this.savePaneChoices();
  }
  private featureVisible(id: string): boolean { return !(id === 'download' && this.offlineViewing || id === 'latest' && Number(this.info?.sub_status) !== 1 || id === 'overview' && !this.slidesEnabled); }
  @Builder
  private settingsMenu() {
    Menu() {
      MenuItem({ content: '自定义常用功能' }).onClick(() => this.settingsCustomizeOpen = true)
      ForEach(this.featureIds.filter((id: string) => !this.pinnedSettings.includes(id) && this.featureVisible(id)), (id: string) => {
        MenuItem({ content: (this.featureChecked(id) ? '✓ ' : '') + this.featureName(id) }).onClick(() => this.featureAction(id))
      }, (id: string) => id)
    }
  }
  @State pinDragId: string = '';
  @State pinDropping: boolean = false;
  private pinDropTimer: number = -1;
  @State pinDragTarget: number = -1;
  @State pinDragOffset: number = 0;
  private beginPinDrag(id: string): void { if (this.pinDropping) return; this.pinDragId = id; this.pinDragOffset = 0; this.pinDragTarget = this.pinnedSettings.indexOf(id); }
  private updatePinDrag(offset: number): void { if (this.pinDropping || !this.pinDragId) return; const index = this.pinnedSettings.indexOf(this.pinDragId); this.pinDragOffset = Math.max(-index * 76, Math.min((this.pinnedSettings.length - 1 - index) * 76, offset)); this.pinDragTarget = Math.max(0, Math.min(this.pinnedSettings.length - 1, index + Math.round(offset / 76))); }
  private pinOffsetFor(id: string): number {
    if (!this.pinDragId) return 0; if (id === this.pinDragId) return this.pinDragOffset;
    const index = this.pinnedSettings.indexOf(id), source = this.pinnedSettings.indexOf(this.pinDragId);
    if (index < 0) return 0; return source < this.pinDragTarget && index > source && index <= this.pinDragTarget ? -76 : source > this.pinDragTarget && index < source && index >= this.pinDragTarget ? 76 : 0;
  }
  private endPinDrag(): void {
    const id = this.pinDragId, index = this.pinnedSettings.indexOf(id), target = this.pinDragTarget;
    if (this.pinDropping || !id) return;
    this.pinDropping = true; this.pinDragOffset = (target - index) * 76;
    clearTimeout(this.pinDropTimer);
    this.pinDropTimer = setTimeout(() => {
      const items = this.pinnedSettings.slice(), current = items.indexOf(id);
      if (current >= 0 && target >= 0 && current !== target) { items.splice(current, 1); items.splice(Math.min(target, items.length), 0, id); this.pinnedSettings = items; this.savePins(); }
      this.pinDragId = ''; this.pinDragTarget = -1; this.pinDragOffset = 0; this.pinDropping = false;
    }, 120);
  }

  private savePins(): void { this.store?.saveJson('pinned-settings.json', JSON.stringify(this.pinnedSettings)); }
  private togglePin(id: string): void { this.pinnedSettings = this.pinnedSettings.includes(id) ? this.pinnedSettings.filter((s: string) => s !== id) : this.pinnedSettings.concat([id]); this.savePins(); }
  private movePin(id: string, direction: number): void { const items = this.pinnedSettings.slice(), index = items.indexOf(id), next = index + direction; if (index < 0 || next < 0 || next >= items.length) return; items.splice(index, 1); items.splice(next, 0, id); this.pinnedSettings = items; this.savePins(); }
  @Builder
  private customizeSettings() {
    Column({ space: 14 }) {
      Row() { Text('常用功能').fontSize(20).fontWeight(FontWeight.Medium).fontColor('#20344D').layoutWeight(1); Button('完成').height(32).fontColor('#168BEE').backgroundColor('#EAF4FF').onClick(() => this.settingsCustomizeOpen = false) }.width('100%')
      Text('拖动右侧横条调整已选功能的顺序').fontSize(13).fontColor('#71839A').width('100%')
      Scroll() { Column({ space: 8 }) { ForEach(this.pinnedSettings.concat(this.featureIds.filter((id: string) => !this.pinnedSettings.includes(id))), (id: string) => {
        Row({ space: 8 }) {
          Checkbox().select(this.pinnedSettings.includes(id)).onChange((checked: boolean) => { if (checked !== this.pinnedSettings.includes(id)) this.togglePin(id); })
          Text(this.featureName(id)).fontSize(15).fontColor('#20344D').layoutWeight(1).maxLines(1)
          if (this.pinnedSettings.includes(id)) {
            Text('≡').id('pin-drag-' + id).fontSize(24).fontColor('#889AAF').width(36).height(44).textAlign(TextAlign.Center)
              .priorityGesture(PanGesture({ direction: PanDirection.Vertical, distance: 4 }).onActionStart(() => this.beginPinDrag(id)).onActionUpdate((event: GestureEvent) => this.updatePinDrag(event.offsetY)).onActionEnd(() => this.endPinDrag()).onActionCancel(() => { this.pinDragId = ''; this.pinDragTarget = -1; this.pinDragOffset = 0; }))
          }
        }.width('100%').height(68).padding(12).backgroundColor('#FFFFFF').borderRadius(12).clip(true).translate({ y: this.pinOffsetFor(id) }).zIndex(this.pinDragId === id ? 2 : 0).shadow({ radius: this.pinDragId === id ? 14 : 0, color: '#26394D26', offsetY: 4 }).animation({ duration: this.pinDragId === id && !this.pinDropping ? 0 : this.pinDragId ? 120 : 0, curve: Curve.EaseOut })
      }, (id: string) => id) }.width('100%').padding({ left: 8, right: 24, top: 8, bottom: 8 }) }.layoutWeight(1).width('100%').scrollable(ScrollDirection.Vertical).onScrollFrameBegin((offset: number, state: ScrollState): OnScrollFrameBeginHandlerResult => { return { offsetRemain: this.pinDragId ? 0 : offset }; })
    }.padding({ top: this.safeTop + 16, bottom: this.safeBottom + 16, left: this.safeLeft + 16, right: this.safeRight + 16 }).width('100%').height('100%').backgroundColor('#F1F3F5')
  }
  @State returnOwner: string = '';
  private returnKind: string = '';
  private returnPoint: StudyReturnPoint | undefined = undefined;
  private clearStudyReturn(): void { this.returnOwner = ''; this.returnKind = ''; this.returnPoint = undefined; }
  private rememberJump(owner: string): void {
    if (!this.course) return;
    const prior = this.returnKind === 'browse' && this.returnOwner === owner && this.returnPoint?.slideId === this.groups[this.selected]?.slide.id ? this.returnPoint : undefined;
    this.returnPoint = { subId: this.course.subId, at: this.learningTime(), slideId: this.groups[this.selected]?.slide.id || '', following: prior?.following ?? this.following, followVideo: prior?.followVideo ?? this.followVideo, followTranscript: prior?.followTranscript ?? this.followTranscript, summary: this.summaryController.capture(), reference: this.noteContentReference };
    this.returnKind = 'jump'; this.returnOwner = owner;
  }
  private undoStudy(): void {
    const point = this.returnPoint, kind = this.returnKind; this.clearStudyReturn();
    if (kind === 'browse') { this.returnToLatest(); return; }
    if (!point || point.subId !== this.course?.subId) return;
    this.jumpToTime(point.at); const index = this.groups.findIndex((group: PageGroup) => group.slide.id === point.slideId); if (index >= 0) this.selected = index;
    this.following = point.following; this.followVideo = point.followVideo; this.followTranscript = point.followTranscript;
    this.summaryResume = point.summary; this.noteContentReference = point.reference; this.noteReferenceSequence++;
    this.highlightAt = -1; this.imageHighlightId = ''; this.highlightSource = ''; this.prepareImages(this.generation);
  }
  private browsed(owner: string = this.activePane): void {
    if ((this.showVideo || Number(this.info?.sub_status) === 1) && ['slides', 'transcript'].includes(owner)) { if (this.returnKind !== 'browse' || this.returnOwner !== owner) this.returnPoint = this.course ? { subId: this.course.subId, at: this.learningTime(), slideId: this.groups[this.selected]?.slide.id || '', following: this.following, followVideo: this.followVideo, followTranscript: this.followTranscript } : undefined; this.returnKind = 'browse'; this.returnOwner = owner; }
    this.following = false; this.followVideo = false; this.followTranscript = false; this.saveProgress(true);
  }
  private videoOpenTicket: number = 0;
  private async toggleVideo(initialAt: number = -1): Promise<void> {
    if (this.showVideo || this.videoBusy) { this.videoOpenTicket++; this.videoBusy = false; this.cancelCameraProbe(); this.cameraCandidates = []; this.fullscreen(false); this.playback.pause(); this.showVideo = false; this.resize(); this.saveProgress(true); return; }
    if (this.videoBusy || !this.course || this.unavailablePane('video')) return;
    const gen = this.generation, ticket = ++this.videoOpenTicket; this.videoBusy = true; this.message = ''; const liveAtOpen = Number(this.info?.sub_status) === 1; this.videoInitialSeconds = !liveAtOpen && initialAt >= 0 ? initialAt : liveAtOpen ? Math.max(0, Date.now() / 1000 - this.course.start) : this.groups[this.selected]?.slide.t || 0; this.videoSource = undefined;
    try {
      const sources: MediaSource[] = this.offlineViewing ? (this.offlineItem?.videoUri ? [{ id: 'offline', title: '离线视频', url: this.offlineItem.videoUri, live: false, offset: this.offlineItem.videoOffset }] : []) : await this.api.videos(this.course);
      if (gen !== this.generation || ticket !== this.videoOpenTicket) return;
      if (!sources.length && (this.offlineViewing || Number(this.info?.sub_status) === 6)) { this.missingPanes = this.missingPanes.concat(['video']); this.preferenceProfile = missingPaneKey(this.missingPanes); this.applyPaneChoices(); }
      if (!sources.length) throw new Error(this.offlineViewing ? '这节课没有下载视频' : '平台暂未提供可播放的视频');
      const live = Number(this.info?.sub_status) === 1; this.liveReplay = false; this.replaySources = sources.filter((source: MediaSource) => !source.live);
      const cameras = live && sources.some((source: MediaSource) => source.live) ? sources.filter((source: MediaSource) => source.live) : sources;
      this.videoTime = !live && initialAt >= 0 ? initialAt : live ? Math.max(0, Date.now() / 1000 - (this.course?.start || Date.now() / 1000)) : this.groups[this.selected]?.slide.t || 0;
      this.videoSources = [cameras[0]]; this.videoSource = cameras[0]; this.followVideo = true; this.showVideo = true; this.following = false; this.followTranscript = true; this.resize();
      // Decoding and network access for source comparison must not compete with the first frame.
      this.cameraCandidates = !this.offlineViewing && cameras.length > 1 ? cameras : []; this.cameraProbeStarted = false;
    } catch (err) { if (gen === this.generation && ticket === this.videoOpenTicket) { this.showVideo = false; this.videoSource = undefined; this.message = (err as Error).message; this.resize(); } }
    finally { if (gen === this.generation && ticket === this.videoOpenTicket) this.videoBusy = false; }
  }
  private async beginReplay(): Promise<boolean> {
    if (!this.showVideo || !this.course) return false;
    if (!this.videoSource?.live || this.videoSeekable) { this.liveReplay = true; return true; }
    const gen = this.generation;
    try {
      if (!this.replaySources.length) this.replaySources = (await this.api.videos(this.course)).filter((source: MediaSource) => !source.live);
      if (gen !== this.generation || !this.showVideo) return false;
      const available = this.replaySources[0];
      if (available && await this.sourceProbe.available(available.url)) { this.liveReplay = true; this.videoInitialSeconds = this.videoTime; this.videoSource = available; return true; }
    } catch (_) {}
    if (gen === this.generation) this.getUIContext().getPromptAction().showToast({ message: '平台暂未提供本节课的直播回看，稍后再试', duration: 2500 });
    return false;
  }
  private resumeLive(): void {
    this.liveReplay = false; this.videoRate = 1; this.followVideo = true; this.followTranscript = true;
    const source = this.videoSources.find((source: MediaSource) => source.live);
    if (source && this.videoSource?.id !== source.id) { this.videoTime = Math.max(0, Date.now() / 1000 - (this.course?.start || Date.now() / 1000)); this.videoInitialSeconds = this.videoTime; this.videoSource = source; }
    else this.playback.goLive();
  }
  private followPlayback(): void {
    if (!this.groups.length) return;
    let index = 0;
    this.groups.forEach((g: PageGroup, i: number) => { if (g.slide.t <= this.videoTime) index = i; });
    if (index !== this.selected) { this.selected = index; this.prepareImages(this.generation); }
  }
  private chooseSlide(slide: Slide): void {
    const index = this.groups.findIndex((g: PageGroup) => g.slide.id === slide.id);
    if (index >= 0) { this.selected = Math.min(index, spreadStart(this.groups.length - 1, this.capacity)); this.browsed(); this.prepareImages(this.generation); }
  }
  private jumpToPage(page: number): void {
    const slide = this.presentationSlides()[Math.max(0, Math.min(this.presentationSlides().length - 1, page - 1))];
    if (!slide) return;
    if (!this.groups.some((g: PageGroup) => g.slide.id === slide.id)) { this.skipEmpty = false; this.store?.savePageOptions(false, false); this.rebuildGroups(); }
    this.chooseSlide(slide);
  }
  private queueImage(slide: Slide): void {
    if (this.imageUris[slide.id] || this.imageQueue.some((s: Slide) => s.id === slide.id)) return;
    this.imageQueue.push(slide); this.loadQueuedImages();
  }
  private async loadQueuedImages(): Promise<void> {
    if (this.loadingImage || !this.store) return;
    this.loadingImage = true; const gen = this.generation, revision = this.imageRevision;
    try {
      while (this.imageQueue.length && gen === this.generation && this.foreground) {
        const slide = this.imageQueue.shift()!;
        try {
          const uri = this.trimBorders ? await this.store.trimmedImage(slide.url) : await this.store.image(slide.url);
          if (gen !== this.generation || revision !== this.imageRevision) return;
          const uris = copyStringMap(this.imageUris); uris[slide.id] = uri; this.imageUris = uris; this.reconcileSlideDuplicates(gen);
        } catch (_) {}
      }
    } finally { this.loadingImage = false; }
  }
  private showMyCourses(tab: string = this.myCoursesTab): void {
    this.myCoursesTab = tab === 'recent' || tab === 'all' ? tab : 'today';
    try { this.store?.saveJson('my-courses-tab.txt', this.myCoursesTab); } catch (_) {}
    if (this.myCoursesTab !== 'all') this.recent = this.myCoursesTab === 'recent'; this.allCoursesOpen = this.myCoursesTab === 'all'; this.myCoursesHomeSequence++;
    this.plaza = false; this.collectionPage = ''; this.notesLibrary = false; this.offlineOpen = false; this.cacheSettings = false; this.downloadsOpen = false;
    this.privacyOpen = false; this.layoutOpen = false; this.overview = false; this.aiPagePicker = false; this.slideFullscreen = false; this.settingsCustomizeOpen = false; this.lessonDownloadOpen = false;
    this.offlineReturn = false; this.catalogAt = 0; this.forcePermissionRefresh = true;
    if (this.screen === 'lesson' || this.screen === 'waiting') this.home(); else this.resume();
  }
  private openHomePage(page: string): void { if (page === 'favourite' || page === 'later') this.collectionRootSequence++; this.collectionPage = page === 'favourite' || page === 'later' ? page : ''; this.collectionBackSequence = 0; this.notesBackSequence = 0; this.cacheBackSequence = 0; this.notesLibrary = page === 'notes'; this.offlineOpen = page === 'offline'; this.cacheSettings = page === 'cache'; this.plaza = false; this.allCoursesOpen = false; if (this.offlineOpen) this.refreshLibrary(); if (!page) this.resume(); }
  private openDownload(courses: Course[], scoped: boolean = false): void {
    if (!this.library) { this.message = '当前没有可下载的课程'; return; }
    if (this.screen === 'lesson' && courses.length === 1 && courses[0].subId === this.course?.subId) { this.lessonDownloadOpen = true; return; }
    this.downloadDiscovered = courses.slice(); this.downloadScopeChecking = scoped; this.downloadBackSequence = 0; this.downloadScoped = scoped; this.downloadCourses = courses; this.downloadsOpen = true;
  }
  private openOffline(entry: OfflineCourse, reference?: CourseJump, noteId: string = ''): void {
    this.entryPaused = !!noteId; this.requestedNoteId = noteId;
    this.skipRanges = []; this.smartRangesKey = ''; this.skipStatus = ''; this.lastAutomaticRange = '';
    if (!reference) this.courseReturnStack = []; this.pendingCourseJump = reference;
    this.closeMedia(); this.stop(); this.offlineViewing = true; this.offlineReturn = true; this.offlineOpen = false;
    this.offlineItem = entry; this.course = entry.course; this.store?.useCourse(entry.course); this.loadProgress(entry.course); this.info = undefined; this.historyReady = true; this.following = false;
    this.trimBorders = true;
    const snapshot = this.library?.snapshot(entry.course.subId) || this.store?.load(entry.course.subId);
    this.slides = entry.options.slides ? snapshot?.slides || [] : []; this.lines = entry.options.transcript ? snapshot?.lines || [] : [];
    this.historicalCaptionMissing = this.lines.some((l: Transcript) => l.timing === 'source' || l.timing === 'received') && !this.lines.some((l: Transcript) => l.timing === 'history');
    this.imageUris = {}; this.groups = groupPages(this.slides, this.lines, this.mergeDuplicateSlides); this.selected = 0; this.screen = 'lesson'; this.message = '';
    this.missingPanes = [!this.slides.length ? 'slides' : '', !this.lines.length ? 'transcript' : '', !entry.videoUri ? 'video' : ''].filter((id: string) => !!id); this.preferenceProfile = missingPaneKey(this.missingPanes); this.applyPaneChoices(); this.resize(); this.rebuildGroups(); this.prepareImages(this.generation);
    this.restoreProgress().then(() => { if (this.offlineItem === entry && this.preferredVideo && !this.showVideo && entry.videoUri) this.toggleVideo(); });
  }
  private jumpReferencedCourse(course: Course, at: number): void {
    if (!this.course) return;
    if (course.subId === this.course.subId) { this.rewind(at, '', '', false, true); return; }
    this.saveProgress(true);
    const current: CourseJump = { course: this.course, at: this.learningTime(), video: this.showVideo, offline: this.offlineViewing ? this.offlineItem : undefined, summary: this.summaryController.capture(), panes: { slides: this.slidesEnabled, transcript: this.transcription, video: this.showVideo, notes: this.notesOpen, ai: this.aiOpen, summary: this.summaryOpen }, rects: this.paneRects.slice(), slideId: this.groups[this.selected]?.slide.id, activePane: this.activePane, following: this.following, followVideo: this.followVideo, followTranscript: this.followTranscript };
    const target: CourseJump = { course, at, video: this.showVideo };
    this.courseReturnStack.push(current);
    if (this.offlineViewing) {
      const entry = this.library?.entry(course.subId), snapshot = this.store?.load(course.subId);
      if (!entry && !snapshot) { this.courseReturnStack.pop(); this.message = '这节课没有离线资料，请联网后跳转'; return; }
      this.openOffline(entry || { course, options: { slides: !!snapshot?.slides.length, transcript: !!snapshot?.lines.length, video: false }, videoUri: '', videoOffset: 0, partial: false, bytes: 0, savedAt: Date.now() }, target);
    } else this.enter(course, target);
  }
  private returnReferencedCourse(): void { const previous = this.courseReturnStack.pop(); if (!previous) return; this.saveProgress(true); if (previous.offline) this.openOffline(previous.offline, previous); else this.enter(previous.course, previous); }
  private summaryFollowingLive(): boolean { if (Number(this.info?.sub_status) !== 1) return false; return this.showVideo ? !this.liveReplay || this.videoTime >= Math.max(0, Date.now() / 1000 - (this.course?.start || 0)) - 5 : this.groups[this.selected]?.slide.id === this.presentationSlides()[this.presentationSlides().length - 1]?.id; }
  private openAi(): void { if (!this.privacyAccepted) { this.privacyOpen = true; return; } this.aiCreated = true; this.aiOpen = !this.aiOpen; if (!this.aiOpen) this.editorFocus('ai', false); this.dock = 'ai'; this.narrowStudy = false; this.resize(); if (this.aiOpen) this.focusPane('ai'); }
  private openNotes(): void { this.notesCreated = true; this.notesOpen = !this.notesOpen; if (!this.notesOpen) this.editorFocus('notes', false); this.dock = 'notes'; this.narrowStudy = false; this.resize(); if (this.notesOpen) this.focusPane('notes'); }
  private playbackChanged(state: PlaybackState): void {
    if (this.cameraCandidates?.length) this.probeReady(state);
    if (!state.paused) this.entryPaused = false;
    if (state.positionReady !== false) this.videoTime = state.time;
    this.videoRate = state.rate; this.videoSeekable = !!state.seekable; this.videoEnd = state.end;
    if (state.width > 0 && state.height > 0) this.videoAspect = state.width / state.height;
    if (this.smartSkip && state.positionReady !== false && !state.paused && this.videoSeekable && (!this.videoSource?.live || this.liveReplay)) { const range = automaticSkip(this.videoTime, this.videoEnd, this.skipRanges), id = range ? range.pageId + ':' + range.start : ''; if (range && id !== this.lastAutomaticRange) { this.lastAutomaticRange = id; this.playback.seek(range.end); this.getUIContext().getPromptAction().showToast({ message: '已跳过' + range.reason, duration: 1500 }); } else if (!range) this.lastAutomaticRange = ''; }
    if (state.positionReady !== false) { if (this.followVideo) this.followPlayback(); this.saveProgress(); }
  }
  private learningTime(): number { return this.showVideo ? this.videoTime : Number(this.info?.sub_status) === 1 && this.following && this.course ? Math.max(0, Date.now() / 1000 - this.course.start) : this.groups[this.selected]?.slide.t ?? this.textStudyTime; }
  private rewind(seconds: number, sourceId: string = '', excerpt: string = '', fromTranscript: boolean = false, imageCue: boolean = false): void {
    let target = this.groups[0]; this.groups.forEach((group: PageGroup) => { if (group.slide.t <= seconds) target = group; });
    const alreadyVisible = fromTranscript && this.continuousTranscript() || !!target && this.visibleGroups().some((group: PageGroup) => group.slide.id === target.slide.id);
    this.jumpToTime(seconds); this.overview = false; this.narrowStudy = true;
    this.highlightAt = this.showVideo || fromTranscript && alreadyVisible ? -1 : seconds; this.highlightSource = sourceId; this.highlightRevision++;
    this.imageHighlightId = target && (imageCue || this.slides.some((slide: Slide) => slide.id === sourceId)) ? target.slide.id : '';
    clearTimeout(this.highlightTimer); this.highlightTimer = setTimeout(() => { this.highlightAt = -1; this.highlightSource = ''; this.imageHighlightId = ''; }, 2000);
  }
  private async aiContext(whole: boolean): Promise<AiContext> {
    const group = this.groups[this.selected];
    const at = this.showVideo ? this.videoTime : Number(this.info?.sub_status) === 1 && this.following && this.course ? Date.now() / 1000 - this.course.start : Math.max(group?.slide.t ?? this.textStudyTime, group?.lines[group.lines.length - 1]?.end || 0);
    const course = this.course, gen = this.generation;
    if (!this.offlineViewing && course && (!this.slides.length && !this.lines.length || whole && !this.historyReady)) {
      const incoming = await Promise.all([this.api.slides(course), this.api.transcripts(course)]);
      if (gen !== this.generation) throw new Error('课程已切换');
      this.slides = mergeSlides(this.slides, incoming[0]); this.lines = reconcileLines(this.lines, incoming[1]); this.historyReady = true; this.rebuildGroups();
    }
    return { slides: this.presentationSlides().slice(), lines: (this.cleanTranscript()).slice(), at, currentId: group?.slide.id, selectedIds: this.aiSelectedIds.slice() };
  }
  @State noteContentReference: NoteContentReference | undefined = undefined;
  @State noteReferenceSequence: number = 0;
  private openNoteReference(reference: NoteContentReference): void {
    if (reference.courseId !== this.course?.subId) { this.message = '这条笔记引用属于其他课次'; return; }
    if (this.store && this.course) {
      const valid = reference.kind === 'question' ? !!new ChatStore(this.store).list().find((session) => session.id === reference.sessionId)?.turns[reference.turn || 0] : reference.pageId ? reference.summaryId ? !!new SummaryCache(this.store, this.course).record(reference.scope || 'page', reference.pageId, reference.summaryId) : !!new SummaryCache(this.store, this.course).latest(reference.scope || 'page')[reference.pageId] : false;
      if (!valid) { this.getUIContext().getPromptAction().showDialog({ title: '相关缓存已被清理', message: '笔记中保存的引用内容仍可查看。', buttons: [{ text: '知道了', color: '#168BEE' }] }).catch(() => {}); return; }
    }
    this.rememberJump('notes'); this.rewind(reference.at); this.noteContentReference = reference; this.noteReferenceSequence++;
    if (reference.kind === 'question') { this.aiCreated = true; this.aiOpen = true; } else { this.summaryCreated = true; this.summaryOpen = true; const page = this.groups.find((group: PageGroup) => group.slide.id === reference.pageId)?.slide; if (page) { const index = this.groups.findIndex((group: PageGroup) => group.slide.id === page.id); this.selected = index; this.prepareImages(this.generation); } }
    this.resize(); this.focusPane(reference.kind === 'question' ? 'ai' : 'summary');
  }
  @State transcriptScrollSequence: number = 0;
  private restoreTranscriptReading(at: number, offset: number): void {
    NativeSelections.clearGroup('transcript'); this.jumpToTime(at); this.transcriptReadingAt = at; this.transcriptReadingOffset = offset; this.followTranscript = false; this.transcriptScrollSequence++;
    if (this.returnOwner === 'transcript') this.clearStudyReturn(); this.prepareImages(this.generation);
  }
  private transcriptReadingAt: number = -1;
  private transcriptReadingOffset: number = 0;

  private openExpandedSlide(slide: Slide): void { NativeSelections.clear(); this.getUIContext().getFocusController().clearFocus(); this.focusedEditors.clear(); this.inputFocused = false; this.expandedSlideId = slide.id; this.slideZoom = 1; this.slideFullscreen = true; }
  private turnExpandedSlide(direction: number): void { const index = this.groups.findIndex((group: PageGroup) => group.slide.id === this.expandedSlideId), nextIndex = manualPage(this.groups, Math.max(0, index), 1, direction, this.skipEmpty), next = this.groups[nextIndex]?.slide; if (!next || next.id === this.expandedSlideId) { this.skipHint(direction); return; } this.expandedSlideId = next.id; this.slideZoom = 1; this.queueImage(next); }
  private focusedEditors: Set<string> = new Set();
  private editorFocus(id: string, focused: boolean): void { if (focused) this.focusedEditors.add(id); else this.focusedEditors.delete(id); this.inputFocused = this.focusedEditors.size > 0; }
  private keyboard(event: KeyEvent): boolean {
    SelectionKeys.update(event);
    if (this.screen !== 'lesson' || event.type !== KeyType.Down || this.inputFocused || this.downloadsOpen || this.jumpingDialogOpen || this.aiPagePicker || this.settingsCustomizeOpen || this.lessonDownloadOpen || this.privacyOpen) return false;
    if (event.getModifierKeyState?.(['Ctrl'])) {
      if (event.keyText.toLowerCase() === 'g') { this.featureAction('page'); return true; }
      if (event.keyText.toLowerCase() === 'o') { this.featureAction('overview'); return true; }
      return false;
    }
    if (event.getModifierKeyState?.(['Shift'])) return false;
    if (this.overview || this.aiPagePicker || this.settingsCustomizeOpen || this.layoutOpen || this.lessonDownloadOpen || this.privacyOpen) return false;
    if (this.slideFullscreen) {
      const left = event.keyCode === KeyCode.KEYCODE_DPAD_LEFT || event.keyCode === KeyCode.KEYCODE_PAGE_UP, right = event.keyCode === KeyCode.KEYCODE_DPAD_RIGHT || event.keyCode === KeyCode.KEYCODE_PAGE_DOWN;
      if (left || right) { this.turnExpandedSlide(right ? 1 : -1); return true; }
      return false;
    }
    if (this.activePane === 'video' && this.showVideo) {
      if (event.keyCode === KeyCode.KEYCODE_DPAD_LEFT || event.keyCode === KeyCode.KEYCODE_DPAD_RIGHT) { this.playback.seek(Math.max(0, Math.min(this.videoEnd || Number.MAX_SAFE_INTEGER, this.videoTime + (event.keyCode === KeyCode.KEYCODE_DPAD_RIGHT ? 15 : -15)))); return true; }
      if (event.keyCode === KeyCode.KEYCODE_SPACE) { this.playback.toggle(); return true; }
      if (event.keyText === '[' || event.keyText === ']') { this.playback.rate(Math.max(0.1, Math.min(16, this.videoRate + (event.keyText === ']' ? 0.1 : -0.1)))); return true; }
      return false;
    }
    if (!['slides', 'transcript', 'summary'].includes(this.activePane)) return false;
    if (event.keyCode === KeyCode.KEYCODE_DPAD_LEFT || event.keyCode === KeyCode.KEYCODE_PAGE_UP) { this.turnPages(-1); return true; }
    if (event.keyCode === KeyCode.KEYCODE_DPAD_RIGHT || event.keyCode === KeyCode.KEYCODE_PAGE_DOWN) { this.turnPages(1); return true; }
    if (event.keyCode === KeyCode.KEYCODE_MOVE_HOME) { this.jumpToPage(1); return true; }
    if (event.keyCode === KeyCode.KEYCODE_MOVE_END) { this.jumpToPage(this.presentationSlides().length); return true; }
    return false;
  }
  @Builder
  private topBar() {
    Row({ space: this.windowWidth < 600 ? 6 : 10 }) {
      Text('智云助手').fontSize(this.windowWidth < 600 ? 17 : 22).fontWeight(FontWeight.Bold).fontColor('#168BEE')
      if (this.screen === 'lesson' || this.screen === 'waiting') {
        Button('我的课堂').padding({ left: 8, right: 8 }).fontSize(12).height(30).backgroundColor(Color.Transparent).fontColor('#168BEE').onClick(() => this.showMyCourses())
        if (this.windowWidth >= 700) { Text(this.course?.title || '').fontSize(15).fontWeight(FontWeight.Medium).fontColor('#425F7D').maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis }).constraintSize({ maxWidth: this.windowWidth * 0.18 }) }
        Scroll() { Row({ space: 6 }) { ForEach(this.pinnedSettings.filter((id: string) => this.featureVisible(id)), (id: string) => {
          Button((this.featureChecked(id) ? '✓ ' : '') + this.featureName(id)).fontSize(12).height(30).fontColor('#168BEE').backgroundColor(this.featureChecked(id) ? '#DDEEFF' : Color.Transparent).onClick(() => this.featureAction(id))
        }, (id: string) => id)
          if (this.windowWidth < 600 && this.course) { CollectionActions({ collections: this.collections, revision: this.collectionRevision, course: this.course, lesson: true }) }
        } }.layoutWeight(1).height(36).scrollable(ScrollDirection.Horizontal).scrollBar(BarState.Off)
        if (this.windowWidth >= 600 && this.course) { CollectionActions({ collections: this.collections, revision: this.collectionRevision, course: this.course, lesson: true }) }
        Button('设置').padding({ left: 8, right: 8 }).fontSize(12).height(30).backgroundColor(Color.Transparent).fontColor('#168BEE').bindMenu(this.settingsMenu)
        Button('返回').padding({ left: 8, right: 8 }).fontSize(12).height(30).backgroundColor(Color.Transparent).fontColor('#168BEE').onClick(() => this.onBackPress())
      } else {
        Scroll() { Row({ space: 4 }) {
          if (this.account) {
            Text(this.account.name).fontSize(13).fontColor('#71839A').maxLines(1).constraintSize({ maxWidth: 120 })
            Button('我的课堂').fontSize(12).height(32).backgroundColor(Color.Transparent).fontColor('#168BEE').onClick(() => this.showMyCourses())
            Button('课程收藏').fontSize(12).height(32).backgroundColor(Color.Transparent).fontColor('#168BEE').onClick(() => this.openHomePage('favourite'))
            Button('稍后再看').fontSize(12).height(32).backgroundColor(Color.Transparent).fontColor('#168BEE').onClick(() => this.openHomePage('later'))
            Button('笔记管理').fontSize(12).height(32).backgroundColor(Color.Transparent).fontColor('#168BEE').onClick(() => this.openHomePage('notes'))
            Button('离线课程').fontSize(12).height(32).backgroundColor(Color.Transparent).fontColor('#168BEE').onClick(() => this.openHomePage('offline'))
            Button('缓存设置').fontSize(12).height(32).backgroundColor(Color.Transparent).fontColor('#168BEE').onClick(() => this.openHomePage('cache'))
            Button('隐私').fontSize(12).height(32).fontColor('#168BEE').backgroundColor(Color.Transparent).onClick(() => this.privacyOpen = true)
            Button('退出登录').fontSize(12).height(32).backgroundColor(Color.Transparent).fontColor('#168BEE').onClick(() => this.logout())
          } else { Button('隐私').fontSize(12).height(32).fontColor('#168BEE').backgroundColor(Color.Transparent).onClick(() => this.privacyOpen = true) }
        } }.layoutWeight(1).height(38).scrollable(ScrollDirection.Horizontal).scrollBar(BarState.Off).align(Alignment.End)
      }
    }.width('100%').height(56).padding({ left: 12, right: 12 })
  }
  @Builder
  private welcome() {
    Column({ space: 22 }) {
      Button('登录智云课堂').height(48).fontSize(16).backgroundColor('#168BEE').fontColor('#FFFFFF').padding({ left: 30, right: 30 })
        .onClick(() => { this.beginLogin(); })
      if (this.account && (this.offlineEntries.length || this.downloadJobs.length)) { Button('离线课程').height(36).fontSize(13).backgroundColor('#EAF4FF').fontColor('#168BEE').onClick(() => this.openHomePage('offline')) }
    }.layoutWeight(1).width('100%').justifyContent(FlexAlign.Center).alignItems(HorizontalAlign.Center).padding(28)
  }
  @Builder
  private catalog() {
    Column({ space: 12 }) {
      Row() {
        Column({ space: 8 }) {
          Text('我的课堂').fontSize(this.windowWidth < 500 ? 26 : 34).fontWeight(FontWeight.Bold).fontColor('#20344D')
          Text(shanghaiDate(this.now)).fontSize(13).fontColor('#7C899A')
        }.alignItems(HorizontalAlign.Start)
        Blank()
        Button('批量下载').height(32).fontSize(12).fontColor('#168BEE').backgroundColor('#EAF4FF').margin({ right: 8 }).onClick(() => this.openDownload(this.visibleCourses().filter((c: Course) => this.coursePermissions[c.subId] === 'allowed')))
        Button('刷新').height(32).fontSize(12).fontColor('#168BEE').backgroundColor('#EAF4FF').onClick(() => { this.catalogAt = 0; this.forcePermissionRefresh = true; this.resume(); })
      }.width('100%').padding({ top: 20, bottom: 20 })
      Row({ space: 8 }) {
        Button('今日课表').height(34).fontSize(13).fontColor(this.recent ? '#71839A' : '#FFFFFF').backgroundColor(this.recent ? '#EAF0F8' : '#168BEE').onClick(() => this.showMyCourses('today'))
        Button('近两周').height(34).fontSize(13).fontColor(this.recent ? '#FFFFFF' : '#71839A').backgroundColor(this.recent ? '#168BEE' : '#EAF0F8').onClick(() => this.showMyCourses('recent'))
        Button('所有课程').height(34).fontSize(13).fontColor('#71839A').backgroundColor('#EAF0F8').onClick(() => this.showMyCourses('all'))
        Blank()
        Button('课程广场').height(34).fontSize(13).fontColor('#168BEE').backgroundColor(Color.Transparent).fontSize(12).onClick(() => { this.message = ''; this.plaza = true; })
      }.width('100%')
      CourseList({ collections: this.collections, collectionRevision: this.collectionRevision, courses: this.visibleCourses(), permissions: this.coursePermissions, now: this.now, busy: this.busy, onEnter: (c: Course) => { this.enter(c); } })
    }.layoutWeight(1).width('100%').padding({ left: this.windowWidth < 600 ? 20 : 40, right: this.windowWidth < 600 ? 20 : 40 })
  }
  private focusLogin(): void {
    if (this.screen === 'login' && !this.authOfficial && !this.authSubmitting) setTimeout(() => this.getUIContext().getFocusController().requestFocus(this.loginField), 30);
  }
  private loginKey(event: KeyEvent, password: boolean): boolean {
    const input = password ? this.loginPasswordInput : this.loginAccountInput;
    if (input.digit(event, password ? this.authPassword : this.authUser, (value: string) => { if (password) this.authPassword = value; else this.authUser = value; })) return true;
    if (event.type !== KeyType.Down) return false;
    if (event.keyCode === KeyCode.KEYCODE_TAB) { this.loginField = password ? 'login-account' : 'login-password'; this.focusLogin(); return true; }
    if (event.keyCode === KeyCode.KEYCODE_ENTER || event.keyCode === KeyCode.KEYCODE_NUMPAD_ENTER) { if (password) this.submitLogin(); else { this.loginField = 'login-password'; this.focusLogin(); } return true; }
    return false;
  }
  private officialLoginKey(event: KeyEvent): boolean {
    if (!this.authOfficial || this.screen !== 'login' || !officialLoginUrl(this.web.getUrl()) || event.type !== KeyType.Down) return false;
    const modified = !!event.metaKey || ['Ctrl', 'Alt', 'Shift'].some((key: string): boolean => !!event.getModifierKeyState?.([key]));
    const digit = physicalDigit(event.keyCode, modified, event.keyText);
    if (!digit) return false;
    this.web.runJavaScript(officialDigitScript(digit)).catch(() => {});
    return true;
  }
  private beginLogin(): void {
    if (!this.privacyAccepted) { this.privacyOpen = true; return; }
    SessionStore.beginLogin();
    this.loginField = 'login-account'; this.screen = 'login'; setTimeout(() => { this.getUIContext().getFocusController().requestFocus('login-account'); }, 80); this.failureCount = 0; this.message = '';
    this.authSubmitted = false; this.authReturnHandled = false; this.authSubmitting = false; this.authOfficial = false; this.authError = ''; this.authPassword = '';
    this.resume();
  }
  private async loginPageReady(url: string): Promise<void> {
    if ((this.screen !== 'login' && this.account) || !this.foreground) return;
    if (/^https:\/\/classroom\.zju\.edu\.cn(?:\/|$)/i.test(url)) {
      if (!this.authReturnHandled) { this.authReturnHandled = true; this.failureCount = 0; this.resume(); }
      return;
    }
    if (!officialLoginUrl(url) || this.authProbe) return;
    this.authProbe = true;
    try {
      const status = JSON.parse(webString(await this.web.runJavaScript(inspectLoginScript))) as LoginStatus;
      this.authReady = status.ready;
      if (status.error) { this.authError = status.error; this.authSubmitting = false; }
      if (this.authSubmitted && status.captcha) { this.authOfficial = true; this.authSubmitting = false; }
      else if (this.authSubmitting && !this.authSubmitted && status.ready) this.dispatchLogin();
    } catch (_) { this.authReady = false; }
    finally {
      this.authProbe = false;
      if (this.authSubmitting && !this.authSubmitted && !this.authReady) {
        clearTimeout(this.authRetry);
        this.authRetry = setTimeout(() => this.loginPageReady(this.web.getUrl()), 100);
      }
    }
  }
  private async probePendingLogin(): Promise<void> {
    if (this.screen !== 'login' || !this.authSubmitting || this.authOfficial || !this.foreground) return;
    try { await this.loginPageReady(this.web.getUrl()); } catch (_) {}
    if (this.screen === 'login' && this.authSubmitting && !this.authOfficial) {
      clearTimeout(this.authRetry);
      this.authRetry = setTimeout(() => this.probePendingLogin(), 200);
    }
  }
  private submitLogin(): void {
    if (!this.authUser.trim() || !this.authPassword || this.authSubmitting) return;
    this.authError = ''; this.authSubmitting = true; this.authSubmitted = false;
    clearTimeout(this.authTimer);
    this.authTimer = setTimeout(() => {
      if (this.screen !== 'login' || !this.authSubmitting) return;
      this.authSubmitting = false; this.authPassword = ''; clearTimeout(this.authRetry); this.authOfficial = true; this.authError = '学校登录暂未完成，请在此继续';
    }, 30000);
    this.probePendingLogin();
  }
  private async dispatchLogin(): Promise<void> {
    if (this.authSubmitted || !this.authSubmitting || !this.authPassword || !officialLoginUrl(this.web.getUrl())) return;
    this.authSubmitted = true;
    try {
      const result = webString(await this.web.runJavaScript(submitLoginScript(this.authUser.trim(), this.authPassword)));
      if (result === 'not-ready') {
        this.authSubmitted = false; this.authReady = false;
        clearTimeout(this.authRetry);
        this.authRetry = setTimeout(() => this.loginPageReady(this.web.getUrl()), 100);
        return;
      }
      this.authPassword = '';
      if (result === 'verification') { this.authOfficial = true; this.authSubmitting = false; clearTimeout(this.authTimer); }
      else if (result !== 'submitted') {
        this.authSubmitted = false; this.authSubmitting = false; clearTimeout(this.authTimer);
        this.authError = '学校登录页面已更新，请使用其他登录方式';
      }
    } catch (_) { this.authPassword = ''; this.authSubmitting = false; clearTimeout(this.authTimer); this.authError = '连接学校登录服务失败，请重试'; }
  }
  @Builder
  private loginView() {
    Column() {
      Row() {
        Button('返回').height(32).fontSize(12).fontColor('#168BEE').backgroundColor('#EAF4FF').onClick(() => this.onBackPress())
        if (this.authOfficial) { Text('请完成学校登录验证').fontSize(12).fontColor('#7C899A').margin({ left: 12 }) }
      }.width('100%').padding(12)
      if (!this.authOfficial) {
        Column({ space: 18 }) {
          Image($r('app.media.app_icon')).width(64).height(64).borderRadius(16)
          Text('登录智云课堂').fontSize(28).fontWeight(FontWeight.Bold).fontColor('#20344D')
          TextInput({ text: this.authUser, controller: this.loginAccountController, placeholder: '学号／职工号／邮箱' }).id('login-account').focusable(true).focusOnTouch(true).defaultFocus(true).onFocus(() => this.loginField = 'login-account').onBlur(() => this.loginAccountInput.reset()).onKeyPreIme((event: KeyEvent): boolean => this.loginKey(event, false)).enterKeyType(EnterKeyType.Next).onSubmit(() => { this.getUIContext().getFocusController().requestFocus('login-password'); }).height(48).backgroundColor('#FFFFFF').onChange((v: string) => this.authUser = v)
          TextInput({ text: this.authPassword, controller: this.loginPasswordController, placeholder: '统一身份认证密码' }).id('login-password').focusable(true).focusOnTouch(true).onFocus(() => this.loginField = 'login-password').onBlur(() => this.loginPasswordInput.reset()).onKeyPreIme((event: KeyEvent): boolean => this.loginKey(event, true)).enterKeyType(EnterKeyType.Done).type(InputType.Password).height(48).backgroundColor('#FFFFFF').onChange((v: string) => this.authPassword = v).onSubmit(() => this.submitLogin())
          if (this.authError) { Text(this.authError).fontSize(12).fontColor('#A15438').width('100%') }
          Button('登录').height(46).width('100%').fontSize(16).backgroundColor('#168BEE').fontColor('#FFFFFF')
            .enabled(!this.authSubmitting && !!this.authUser.trim() && !!this.authPassword).onClick(() => this.submitLogin())
          if (this.authSubmitting) { Text('正在登录智云课堂，请稍等').fontSize(12).fontColor('#168BEE') }
          Text('使用浙江大学统一身份认证').fontSize(12).fontColor('#889AAF')
          Button('其他登录方式').height(30).fontSize(12).fontColor('#168BEE').backgroundColor(Color.Transparent).onClick(() => { this.authOfficial = true; this.authSubmitting = false; this.authSubmitted = false; this.authPassword = ''; clearTimeout(this.authTimer); clearTimeout(this.authRetry); })
        }.width('90%').constraintSize({ maxWidth: 420 }).layoutWeight(1).justifyContent(FlexAlign.Center)
      }
    }.layoutWeight(this.authOfficial ? 0 : 1).width('100%')
  }
  @Builder
  private authenticationWeb() {
      Web({ src: 'https://tgmedia.cmc.zju.edu.cn?forward=https%3A%2F%2Fclassroom.zju.edu.cn%2F&tenant_code=112', controller: this.web }).layoutWeight(this.authOfficial && this.screen === 'login' ? 1 : 0).height(this.authOfficial && this.screen === 'login' ? '100%' : 1).width('100%').visibility(Visibility.Visible).opacity(this.authOfficial && this.screen === 'login' ? 1 : 0).focusable(this.authOfficial && this.screen === 'login').defaultFocus(false).hitTestBehavior(this.authOfficial && this.screen === 'login' ? HitTestMode.Default : HitTestMode.None)
        .onKeyPreIme((event: KeyEvent): boolean => this.officialLoginKey(event))
        .javaScriptAccess(true).domStorageAccess(true).mixedMode(MixedMode.None).mediaPlayGestureAccess(true).metaViewport(true).overviewModeAccess(true).zoomAccess(true)
        .onPageBegin((event) => {
          this.authReady = false;
          if (/^https:\/\/classroom\.zju\.edu\.cn(?:\/|$)/i.test(event?.url || '')) this.loginPageReady(event?.url || '');
        })
        .onProgressChange((event) => { if ((event?.newProgress || 0) >= 40 && !this.authReady) this.loginPageReady(this.web.getUrl()); })
        .onPageEnd((event) => { this.loginPageReady(event?.url || ''); this.focusLogin(); })
        .onInterceptRequest((event) => {
          const url = event?.request.getRequestUrl() || '';
          if (/\.(m3u8|mp4|flv|ts|m4s|mpd)(\?|$)/i.test(url)) {
            const response = new WebResourceResponse(); response.setResponseCode(204); response.setResponseData(''); response.setResponseMimeType('text/plain'); return response;
          }
          return null;
        })

  }
  @Builder
  private waiting() {
    Column({ space: 18 }) {
      Text(this.course?.title || '').fontSize(28).fontWeight(FontWeight.Bold).fontColor('#20344D').textAlign(TextAlign.Center)
      Text(this.syncState || '正在连接课堂…').fontSize(16).fontColor('#71839A')
      if (this.course && this.now < this.course.start) { Text('上课后自动进入学习').fontSize(13).fontColor('#8A97A8') }
    }.width('100%').layoutWeight(1).justifyContent(FlexAlign.Center).padding(24)
  }
  @Builder
  private slideContent() {
    Column({ space: 8 }) {
      if (!this.slidesEnabled && !this.transcription && !this.showVideo) {
        Column() { Text('请打开功能').fontSize(18).fontColor('#71839A') }.layoutWeight(1).width('100%').justifyContent(FlexAlign.Center)
      } else if (!this.slidesEnabled && !this.transcription && this.showVideo) {
        Blank().layoutWeight(1).width('100%')
      } else if (!this.slidesEnabled && this.transcription && this.lines.length) {
        Scroll() { TranscriptText({ lines: this.lines, notesOpen: this.notesOpen, highlightAt: this.highlightAt, highlightSource: this.highlightSource, onInsert: (value: NoteInsertion) => this.notes.insert(value) }).width('100%').padding(12) }
          .layoutWeight(1).width('100%').scrollBar(BarState.Auto)
      } else if (this.slidesEnabled && this.groups.length) {
        SlidePager({ gridMode: this.activePanes().length === 1 && this.capacity > 1, imageHighlightId: this.imageHighlightId, onSkipBlocked: (direction: number) => this.skipHint(direction), skipEmpty: this.skipEmpty, manual: this.manualBrowsing(), onJump: (at: number, id: string) => { this.rememberJump('slides'); this.rewind(at, id); }, groups: this.groups, slides: this.presentationSlides(), selected: $selected, capacity: this.capacity, imageUris: this.imageUris, transcription: false, transcriptState: this.transcriptState, notesOpen: this.notesOpen, highlightAt: this.highlightAt, highlightSource: this.highlightSource, slideShare: this.slideShare, onInsert: (value: NoteInsertion) => { this.notes.insert(value); this.dock = 'notes'; this.narrowStudy = false; }, stacked: false, onExpand: (slide: Slide) => this.openExpandedSlide(slide),
          onTurn: (direction: number) => this.turnPages(direction), onBrowse: () => this.browsed(),
          onPosition: () => { this.browsed(); this.prepareImages(this.generation); }, onPreview: (index: number) => this.prepareImages(this.generation, index)
        }).layoutWeight(1).width('100%')
      } else if (this.slidesEnabled && this.transcription && this.offlineViewing && this.lines.length) {
        Scroll() { TranscriptText({ lines: this.lines, notesOpen: this.notesOpen, highlightAt: this.highlightAt, highlightSource: this.highlightSource, onInsert: (value: NoteInsertion) => this.notes.insert(value) }).width('100%').padding(12) }.layoutWeight(1).width('100%')
      } else {
        Column({ space: 12 }) { Text(this.slidesEnabled ? (this.offlineViewing ? '未下载课件' : '等待第一张课件') : (this.transcription ? '等待课程转写' : '请打开功能')).fontSize(20).fontColor('#375A7F') }.layoutWeight(1).width('100%').justifyContent(FlexAlign.Center)
      }
      if (this.slidesEnabled && this.groups.length) {
        Row({ space: 6 }) {
          Button('‹').accessibilityText('上一组课件').width(36).height(30).fontColor('#168BEE').backgroundColor('#EAF4FF').enabled(this.selected > 0).onClick(() => this.turnPages(-1))
          Blank()
          if (this.activePanes().length === 1) { Button() { DropdownLabel({ label: this.capacity + ' 页', labelSize: 11 }) }.padding(0).height(30).fontSize(11).fontColor('#168BEE').backgroundColor('#EAF4FF').bindMenu([1, 2, 3, 4].map((count: number): MenuElement => { return { value: '显示 ' + count + ' 张课件', action: () => { this.slideCount = count; this.resize(); this.prepareImages(this.generation); } }; })) }
          Text(this.pageLabel()).fontSize(11).fontColor('#7C899A').onClick(() => this.pageDialog.open())
          Blank()
          if (Number(this.info?.sub_status) === 1) { Button('回到最新').id('slides-latest').height(30).fontSize(11).fontColor('#168BEE').backgroundColor('#EAF4FF').onClick(() => this.latestSlide()) }
          if (this.returnOwner === 'slides') { ReturnAction({ owner: 'slides', onReturn: () => this.undoStudy() }) }
          Button('›').accessibilityText('下一组课件').width(36).height(30).fontColor('#168BEE').backgroundColor('#EAF4FF').enabled(this.selected + this.capacity < this.groups.length).onClick(() => this.turnPages(1))
        }.width('100%')
      }
    }.height('100%').width('100%')
  }
  @Builder
  private videoContent() {
    VideoPane({ autoplay: !this.entryPaused, store: this.store, liveCourse: Number(this.info?.sub_status) === 1, replayEnabled: this.liveReplay, onReplay: () => { this.beginReplay(); }, onLive: () => this.latestSlide(), source: this.videoSource, sources: this.videoSources, courseStart: this.course?.start || 0, fullscreen: this.videoFullscreen, onFullscreen: () => this.fullscreen(!this.videoFullscreen), onOverview: () => { this.layoutOpen = false; this.overview = true; }, initialSeconds: this.videoInitialSeconds, playback: this.playback,
      onState: (state: PlaybackState) => this.playbackChanged(state),
      onClickVideo: () => this.returnToLatest(), onSource: (source: MediaSource) => { this.videoInitialSeconds = this.videoTime; this.videoSource = source; this.followVideo = true; }
    }).width('100%').height('100%')
  }
  @Builder
  private aiPane() {
    AiPanel({ onSelecting: (active: boolean) => this.paneSelecting('ai', active), returnVisible: this.returnOwner === 'ai', onReturn: () => this.undoStudy(), onDismissReturn: () => { this.activatePane('ai'); if (this.returnOwner === 'ai') this.clearStudyReturn(); }, notesOpen: this.notesOpen, requestedReference: this.noteContentReference, referenceSequence: this.noteReferenceSequence, onInsert: (value: NoteInsertion) => this.notes.insert(value), selectedCount: this.aiSelectedIds.length, onSelectPages: () => { NativeSelections.clear(); this.layoutOpen = false; this.aiPagePicker = true; }, onEditingFocus: (focused: boolean) => this.editorFocus('ai', focused), courseId: this.course?.subId || '', active: this.aiOpen && this.foreground, store: this.store,
      context: (whole: boolean) => this.aiContext(whole), onClose: () => { this.aiOpen = false; this.dock = 'notes'; this.narrowStudy = true; this.resize(); },
      onJump: (seconds: number) => { this.rememberJump('ai'); this.rewind(seconds, '', '', false, true); } }).width('100%').height('100%')
      .visibility(this.aiOpen && !this.videoFullscreen ? Visibility.Visible : Visibility.None)
  }
  @Builder
  private notesPane() {
    NotesPane({ onDragging: (active: boolean) => this.paneSelecting('notes', active), onCourseJump: (course: Course, at: number) => this.jumpReferencedCourse(course, at), onDismissReturn: () => { this.activatePane('notes'); if (this.returnOwner === 'notes') this.clearStudyReturn(); }, returnVisible: this.returnOwner === 'notes', onReturn: () => this.undoStudy(), requestedNoteId: this.requestedNoteId, onContentJump: (reference: NoteContentReference) => this.openNoteReference(reference), account: this.account, onEditingFocus: (focused: boolean) => this.editorFocus('notes', focused), course: this.course, store: this.store, notes: this.notes, currentTime: () => this.learningTime(),
      onJump: (at: number, sourceId: string, excerpt: string) => { this.rememberJump('notes'); this.rewind(at, sourceId, excerpt); },
      onClose: () => { this.notesOpen = false; this.dock = 'ai'; this.narrowStudy = true; this.resize(); } }).width('100%').height('100%')
      .visibility(this.notesOpen && !this.videoFullscreen ? Visibility.Visible : Visibility.None)
  }
  @Builder
  private summaryPane() {
    PageSummary({ onSelecting: (active: boolean) => this.paneSelecting('summary', active), returnVisible: this.returnOwner === 'summary', onReturn: () => this.undoStudy(), onDismissReturn: () => { this.activatePane('summary'); if (this.returnOwner === 'summary') this.clearStudyReturn(); }, controller: this.summaryController, restoredView: this.summaryResume, notesOpen: this.notesOpen, requestedReference: this.noteContentReference, referenceSequence: this.noteReferenceSequence, onInsert: (value: NoteInsertion) => this.notes.insert(value), followingLive: this.summaryFollowingLive(), onCourseJump: (course: Course, at: number) => this.jumpReferencedCourse(course, at), contextTime: () => this.showVideo ? this.videoTime : Number(this.info?.sub_status) === 1 && this.following && this.course ? Math.max(0, Date.now() / 1000 - this.course.start) : Number.POSITIVE_INFINITY, offline: this.offlineViewing, savedLessons: () => (this.library?.list() || []).map((entry: OfflineCourse) => this.library?.snapshot(entry.course.subId)).filter((snapshot: Snapshot | undefined) => !!snapshot) as Snapshot[], imageRevision: this.imageRevision, opened: this.summaryOpen, onTurn: (direction: number) => this.turnPages(direction, 1), live: Number(this.info?.sub_status) === 1, courseId: this.course?.subId || '', active: this.summaryOpen && this.foreground, store: this.store, slides: this.presentationSlides(), lines: this.cleanTranscript(), currentId: this.groups[this.selected]?.slide.id || '', onClose: () => { this.summaryOpen = false; this.resize(); }, onEditingFocus: (focused: boolean) => this.editorFocus('summary', focused), onConfigure: () => { this.aiCreated = true; this.aiOpen = true; this.resize(); }, onJump: (at: number) => { this.rememberJump('summary'); this.rewind(at, '', '', false, true); } }).width('100%').height('100%')
  }
  @Builder
  private transcriptPane() {
    TranscriptPane({ lessonId: this.course?.subId || '', readingMode: !this.showVideo, restoreRevision: this.transcriptScrollSequence, onRestore: (at: number, offset: number) => this.restoreTranscriptReading(at, offset), onDragging: (active: boolean) => this.paneSelecting('transcript', active), showReturn: this.returnOwner === 'transcript', resumeAt: this.transcriptReadingAt >= 0 ? this.transcriptReadingAt : this.groups[this.selected]?.slide.t || this.textStudyTime, resumeOffset: this.transcriptReadingOffset, onReadingPosition: (at: number, offset: number) => { this.transcriptReadingAt = at; this.transcriptReadingOffset = offset; }, slots: this.continuousTranscript() ? 1 : this.capacity, continuous: this.continuousTranscript(), playbackColored: this.showVideo || Number(this.info?.sub_status) === 1, highlightRevision: this.highlightRevision, onSelecting: (active: boolean) => { if (active) { this.activePane = 'transcript'; } }, groups: this.visibleGroups(), slides: this.presentationSlides(), historicalMissing: this.historicalCaptionMissing, canFollow: this.showVideo || Number(this.info?.sub_status) === 1, following: this.followTranscript && (this.showVideo ? this.followVideo : this.following), onBrowse: () => { this.activePane = 'transcript'; this.browsed('transcript'); }, onReturn: () => this.undoStudy(), lines: this.displayedTranscript(), playbackAt: this.showVideo ? this.videoTime : Number(this.info?.sub_status) === 1 ? Math.max(0, this.now - (this.course?.start || this.now)) : -1, notesOpen: this.notesOpen, highlightAt: this.highlightAt, highlightSource: this.highlightSource, status: this.skipStatus || this.emptyTranscriptState(), onJump: (at: number, sourceId: string, excerpt: string) => { if (this.showVideo) this.rememberJump('transcript'); else if (this.returnOwner === 'transcript') this.clearStudyReturn(); this.rewind(at, sourceId, excerpt, true); }, onTurn: (direction: number) => this.turnPages(direction, this.capacity, 'transcript'), onInsert: (value: NoteInsertion) => this.notes.insert(value) }).width('100%').height('100%')
  }
  @Builder
  private lesson() {
    Stack({ alignContent: Alignment.TopStart }) {
      Scroll(this.workspaceScroller) {
        Stack({ alignContent: Alignment.TopStart }) {
          Column().width('100%').height('100%').backgroundColor('#F4F7FB').onClick(() => { this.editingPane = ''; NativeSelections.clear(); })
          if (this.showVideo) { PaneFrame({ onBackgroundFocus: () => { this.focusedEditors.clear(); this.inputFocused = false; }, rect: this.pane('video'), canvasWidth: this.workspaceWidth, canvasHeight: this.canvasHeight(), controls: !this.videoFullscreen, selected: this.editingPane === 'video', onSelect: () => this.editingPane = 'video', onActivate: () => this.activatePane('video'), adjustable: !this.videoFullscreen && !this.layoutLocked, onChange: (rect: PaneRect) => this.setPane(rect), content: () => { this.videoContent(); } }).width(this.paneWidth('video')).height(this.paneHeight('video')).position({ x: this.paneX('video'), y: this.paneY('video') }).zIndex(this.videoFullscreen ? 200 : this.pane('video').z) }
          PaneFrame({ onBackgroundFocus: () => { this.focusedEditors.clear(); this.inputFocused = false; }, rect: this.pane('slides'), canvasWidth: this.workspaceWidth, canvasHeight: this.canvasHeight(), controls: !this.videoFullscreen, selected: this.editingPane === 'slides', onSelect: () => this.editingPane = 'slides', onActivate: () => this.activatePane('slides'), adjustable: !this.videoFullscreen && !this.layoutLocked, onChange: (rect: PaneRect) => this.setPane(rect), content: () => { this.slideContent(); } }).width(this.paneWidth('slides')).height(this.paneHeight('slides')).position({ x: this.paneX('slides'), y: this.paneY('slides') }).zIndex(this.pane('slides').z).visibility(this.slidesEnabled && !this.videoFullscreen ? Visibility.Visible : Visibility.None)
          PaneFrame({ onBackgroundFocus: () => { this.focusedEditors.clear(); this.inputFocused = false; }, rect: this.pane('transcript'), canvasWidth: this.workspaceWidth, canvasHeight: this.canvasHeight(), controls: !this.videoFullscreen, selected: this.editingPane === 'transcript', onSelect: () => this.editingPane = 'transcript', onActivate: () => this.activatePane('transcript'), adjustable: !this.videoFullscreen && !this.layoutLocked, onChange: (rect: PaneRect) => this.setPane(rect), content: () => { this.transcriptPane(); } }).width(this.paneWidth('transcript')).height(this.paneHeight('transcript')).position({ x: this.paneX('transcript'), y: this.paneY('transcript') }).zIndex(this.pane('transcript').z).visibility(this.transcription && !this.videoFullscreen ? Visibility.Visible : Visibility.None)
          if (this.aiCreated) { PaneFrame({ onBackgroundFocus: () => { this.focusedEditors.clear(); this.inputFocused = false; }, rect: this.pane('ai'), canvasWidth: this.workspaceWidth, canvasHeight: this.canvasHeight(), controls: !this.videoFullscreen, selected: this.editingPane === 'ai', onSelect: () => this.editingPane = 'ai', onActivate: () => this.activatePane('ai'), adjustable: !this.videoFullscreen && !this.layoutLocked, onChange: (rect: PaneRect) => this.setPane(rect), content: () => { this.aiPane(); } }).width(this.paneWidth('ai')).height(this.paneHeight('ai')).position({ x: this.paneX('ai'), y: this.paneY('ai') }).zIndex(this.pane('ai').z).visibility(this.aiOpen && !this.videoFullscreen ? Visibility.Visible : Visibility.None) }
          if (this.notesCreated) { PaneFrame({ onBackgroundFocus: () => { this.focusedEditors.clear(); this.inputFocused = false; }, rect: this.pane('notes'), canvasWidth: this.workspaceWidth, canvasHeight: this.canvasHeight(), controls: !this.videoFullscreen, selected: this.editingPane === 'notes', onSelect: () => this.editingPane = 'notes', onActivate: () => this.activatePane('notes'), adjustable: !this.videoFullscreen && !this.layoutLocked, onChange: (rect: PaneRect) => this.setPane(rect), content: () => { this.notesPane(); } }).width(this.paneWidth('notes')).height(this.paneHeight('notes')).position({ x: this.paneX('notes'), y: this.paneY('notes') }).zIndex(this.pane('notes').z).visibility(this.notesOpen && !this.videoFullscreen ? Visibility.Visible : Visibility.None) }
          if (this.summaryCreated) { PaneFrame({ onBackgroundFocus: () => { this.focusedEditors.clear(); this.inputFocused = false; }, rect: this.pane('summary'), canvasWidth: this.workspaceWidth, canvasHeight: this.canvasHeight(), controls: !this.videoFullscreen, selected: this.editingPane === 'summary', onSelect: () => this.editingPane = 'summary', onActivate: () => this.activatePane('summary'), adjustable: !this.videoFullscreen && !this.layoutLocked, onChange: (rect: PaneRect) => this.setPane(rect), content: () => { this.summaryPane(); } }).width(this.paneWidth('summary')).height(this.paneHeight('summary')).position({ x: this.paneX('summary'), y: this.paneY('summary') }).zIndex(this.pane('summary').z).visibility(this.summaryOpen && !this.videoFullscreen ? Visibility.Visible : Visibility.None) }
          if (!this.activePanes().length) { Text('请打开功能').fontSize(18).fontColor('#71839A').width('100%').height('100%').textAlign(TextAlign.Center) }
        }.width('100%').height(this.canvasHeight()).clip(true)
      }.width('100%').height('100%').align(Alignment.TopStart).scrollable(this.videoFullscreen ? ScrollDirection.None : ScrollDirection.Vertical).enableScrollInteraction(!this.selectingPane).scrollBar(this.windowWidth < 600 && !this.videoFullscreen ? BarState.Auto : BarState.Off)
      if (this.smartSkip && (this.skipPreparing || this.skipProgress.running) && !this.videoFullscreen) {
        Row({ space: 10 }) { Text(this.skipPreparing ? '正在准备课程资料' : '正在处理无效内容').fontSize(11).fontColor('#71839A'); Progress({ value: this.skipProgress.completed, total: Math.max(1, this.skipProgress.total), type: ProgressType.Linear }).id('smart-skip-progress').layoutWeight(1).color('#168BEE'); Text(this.skipPreparing ? '加载中' : this.skipProgress.completed + '/' + this.skipProgress.total).fontSize(11).fontColor('#71839A') }.height(30).width('100%').padding({ left: 16, right: 16 }).backgroundColor('#F4F7FBEF').hitTestBehavior(HitTestMode.None).zIndex(500)
      }
    }.layoutWeight(1).width('100%').onAreaChange((oldArea: Area, area: Area) => { const width = Number(area.width), height = Number(area.height); if (width !== this.workspaceWidth || height !== this.workspaceHeight) { this.workspaceWidth = width; this.workspaceHeight = height; this.resize(); } })
  }
  @Builder
  private enlargedSlide() {
    Stack({ alignContent: Alignment.TopEnd }) {
      Image(this.imageUris[this.expandedSlideId] || '').id('expanded-slide').width('100%').height('100%').objectFit(ImageFit.Contain).scale({ x: this.slideZoom, y: this.slideZoom })
        .parallelGesture(PinchGesture().onActionUpdate((event: GestureEvent) => this.slideZoom = Math.max(1, Math.min(5, event.scale))))
        .gesture(GestureGroup(GestureMode.Exclusive, PanGesture({ direction: PanDirection.Horizontal, distance: 18 }).onActionEnd((event: GestureEvent) => { if (Math.abs(event.offsetX) > 50 && this.slideZoom === 1) this.turnExpandedSlide(event.offsetX > 0 ? -1 : 1); }), TapGesture({ count: 1 }).onAction(() => this.slideFullscreen = false)))
      Button('返回课件').height(36).fontSize(12).backgroundColor('#252525').fontColor('#FFFFFF').margin(14).onClick(() => this.slideFullscreen = false)
    }.width('100%').height('100%').backgroundColor('#000000').clip(true)
  }
  build() {
    Stack() {
    Column() {
      if (!this.videoFullscreen) { this.topBar() }
      if (this.message && !this.videoFullscreen) {
        Row({ space: 10 }) {
          Text(this.message).fontSize(12).fontColor('#8C653D').layoutWeight(1)
          Button('重试').height(28).fontSize(11).backgroundColor('#EEE5D8').fontColor('#8C653D').onClick(() => this.resume())
          Button('登录').height(28).fontSize(11).backgroundColor('#EEE5D8').fontColor('#8C653D').onClick(() => { this.beginLogin(); })
        }.padding({ left: 16, right: 16, bottom: 10 }).width('100%')
      }
      if (this.cacheSettings && this.screen === 'home') { CacheSettings({ backSequence: this.cacheBackSequence, store: this.store, onClose: () => this.openHomePage('') }).layoutWeight(1) }
      else if (this.notesLibrary && this.screen === 'home') { NotesLibrary({ onOpen: (note: LessonNote) => this.openManagedNote(note), account: this.account, backSequence: this.notesBackSequence, store: this.store, onClose: () => this.openHomePage('') }).layoutWeight(1) }
      else if (this.offlineOpen && this.screen === 'home') { OfflineScreen({ concurrency: this.library?.concurrency() || 1, onConcurrency: (count: number) => this.library?.setConcurrency(count), onPauseJob: (id: string) => this.library?.pauseJob(id), onResumeJob: (id: string) => this.library?.resumeJob(id), onMoveJob: (id: string, direction: number) => this.library?.moveJob(id, direction), collections: this.collections, collectionRevision: this.collectionRevision, entries: this.offlineEntries, jobs: this.downloadJobs, onDeleteMany: (ids: string[]) => this.library?.removeMany(ids).catch(() => this.getUIContext().getPromptAction().showToast({ message: '删除未完成，请重试', duration: 2000 })), onClose: () => this.openHomePage(''), onOpen: (entry: OfflineCourse) => this.openOffline(entry), onPause: () => this.library?.pause(), onResume: () => this.library?.resume(), onDelete: (entry: OfflineCourse) => this.library?.remove(entry.course.subId).catch(() => this.getUIContext().getPromptAction().showToast({ message: '删除未完成，请重试', duration: 2000 })), onSaveAvailable: (subId: string) => this.library?.saveAvailable(subId), onRetry: (job: DownloadJob) => this.library?.retryJob(job.course.subId), onDeleteJob: (subId: string) => this.library?.remove(subId).catch(() => this.getUIContext().getPromptAction().showToast({ message: '删除未完成，请重试', duration: 2000 })) }).layoutWeight(1) }
      else if (this.screen === 'login') { this.loginView() }
      else if (this.screen === 'waiting') { this.waiting() }
      else if (this.screen === 'lesson') { this.lesson() }
      else if (this.account && !this.plaza && !this.allCoursesOpen && !this.collectionPage) { this.catalog() }
      else if (!this.account) { this.welcome() }
      if (this.privacyAccepted && (!this.account || this.screen === 'login') && !this.offlineViewing && !this.offlineOpen) { this.authenticationWeb() }
      if (this.account && this.collectionPage) {
        CollectionsPage({ now: this.now, collections: this.collections, revision: this.collectionRevision, kind: this.collectionPage, account: this.account, store: this.store, rootSequence: this.collectionRootSequence, backSequence: this.collectionBackSequence, active: this.foreground && this.screen === 'home', onBack: () => this.openHomePage(''), onEnter: (course: Course) => this.enter(course) }).layoutWeight(1).visibility(this.screen === 'home' ? Visibility.Visible : Visibility.None)
      }
      if (this.account && this.allCoursesOpen) {
        MyCourses({ homeSequence: this.myCoursesHomeSequence, refreshSequence: this.downloadScopeRefresh, onDiscovered: (courses: Course[], checking: boolean) => { if (this.downloadsOpen && this.downloadScoped && this.allCoursesOpen) { this.downloadDiscovered = courses; this.downloadScopeChecking = checking; } }, collections: this.collections, collectionRevision: this.collectionRevision, account: this.account, currentCourses: this.courses, store: this.store, backSequence: this.allCoursesBackSequence, active: this.foreground && this.screen === 'home' && !this.offlineOpen && !this.notesLibrary && !this.cacheSettings, onBack: () => this.showMyCourses(this.recent ? 'recent' : 'today'), onEnter: (course: Course) => this.enter(course), onDownload: (courses: Course[]) => this.openDownload(courses, true) }).layoutWeight(1).visibility(this.screen === 'home' && !this.offlineOpen && !this.notesLibrary && !this.cacheSettings ? Visibility.Visible : Visibility.None)
      }
      if (this.account && this.plaza) {
        Plaza({ collections: this.collections, collectionRevision: this.collectionRevision, refreshSequence: this.downloadScopeRefresh, onDiscovered: (courses: Course[], checking: boolean) => { if (this.downloadsOpen && this.downloadScoped) { this.downloadDiscovered = courses; this.downloadScopeChecking = checking; } }, account: this.account, store: this.store, active: this.foreground && this.screen === 'home' && !this.offlineOpen && !this.notesLibrary && !this.cacheSettings, backSequence: this.plazaBackSequence, onEnter: (c: Course) => { this.enter(c); }, onDownload: (courses: Course[]) => this.openDownload(courses, true), onBack: () => { this.plaza = false; this.catalogAt = 0; this.forcePermissionRefresh = true; this.resume(); } })
          .visibility(this.screen === 'home' && !this.offlineOpen && !this.notesLibrary && !this.cacheSettings ? Visibility.Visible : Visibility.None)
      }
    }.width('100%').height('100%').backgroundColor(this.videoFullscreen ? '#000000' : '#F1F3F5').padding(this.videoFullscreen ? 0 : { top: this.safeTop, bottom: this.safeBottom, left: this.safeLeft, right: this.safeRight })
      .onAreaChange((oldArea: Area, newArea: Area) => {
        const width = Number(newArea.width), height = Number(newArea.height); if (width !== this.windowWidth || height !== this.windowHeight) { this.windowWidth = width; this.windowHeight = height; this.resize(); }
      })
      if (this.overview && this.screen === 'lesson' && this.slidesEnabled) {
      SlideOverview({ skipModes: this.smartSkip, mergeDuplicates: this.mergeDuplicateSlides, onMerge: () => this.toggleDuplicateSlides(), groups: visiblePageGroups(this.groups, this.skipEmpty, Number(this.info?.sub_status) === 1), slides: this.presentationSlides(), imageUris: this.imageUris, skipEmpty: this.skipEmpty, selectedId: this.groups[this.selected]?.slide.id || '', onSkip: () => this.toggleSkipEmpty(), onClose: () => this.overview = false, onSelect: (slide: Slide) => { this.chooseSlide(slide); this.overview = false; }, onLoad: (slide: Slide) => this.queueImage(slide) }).width('100%').height('100%').padding({ top: this.safeTop, bottom: this.safeBottom, left: this.safeLeft, right: this.safeRight }).backgroundColor('#F1F3F5')
    }
    if (this.aiPagePicker) { SlideOverview({ skipModes: this.smartSkip, mergeDuplicates: this.mergeDuplicateSlides, onMerge: () => this.toggleDuplicateSlides(), onSkip: () => this.toggleSkipEmpty(), onChoose: (ids: string[]) => this.aiSelectedIds = ids, multiSelect: true, chosenIds: this.aiSelectedIds, groups: visiblePageGroups(this.groups, this.skipEmpty, Number(this.info?.sub_status) === 1), slides: this.presentationSlides(), imageUris: this.imageUris, skipEmpty: this.skipEmpty, onClose: () => this.aiPagePicker = false, onToggle: (id: string) => this.aiSelectedIds = this.aiSelectedIds.includes(id) ? this.aiSelectedIds.filter((s: string) => s !== id) : this.aiSelectedIds.concat([id]), onLoad: (slide: Slide) => this.queueImage(slide) }).width('100%').height('100%').padding({ top: this.safeTop, bottom: this.safeBottom, left: this.safeLeft, right: this.safeRight }).backgroundColor('#F1F3F5') }
    if (this.settingsCustomizeOpen) { this.customizeSettings() }
    if (this.slideFullscreen) { this.enlargedSlide() }
    if (this.layoutOpen) {
      LayoutPanel({ rects: this.paneRects, activeIds: this.activePanes(), locked: this.layoutLocked, onLock: () => { this.layoutLocked = !this.layoutLocked; this.editingPane = ''; }, onSelect: (id: string) => { this.activePane = id; }, onChange: (rect: PaneRect) => this.setPane(rect), onPreset: (preset: string) => this.layoutPreset(preset), onClose: () => this.layoutOpen = false, onSave: () => this.saveLayout(), onLayer: (id: string, action: string) => { if (!this.layoutLocked) this.paneRects = reorderPanes(this.paneRects, id, action); } }).width(this.windowWidth > 700 ? 520 : '94%').borderRadius(18).clip(true).shadow({ radius: 20, color: '#18314733' })
    }
    if (this.privacyOpen) { PrivacyPage({ consentRequired: !this.privacyAccepted, onClose: () => this.privacyOpen = false, onAccept: () => { this.privacyAccepted = true; this.privacyOpen = false; this.restoreAccount(); }, onWithdraw: () => { new PrivacyService(this.getUIContext().getHostContext() as common.UIAbilityContext).withdraw(); this.logout(); this.privacyAccepted = false; this.privacyOpen = true; } }).width('100%').height('100%').padding({ top: this.safeTop, bottom: this.safeBottom, left: this.safeLeft, right: this.safeRight }).backgroundColor('#F1F3F5') }
    if (this.lessonDownloadOpen) { LessonDownload({ course: this.course, onClose: () => this.lessonDownloadOpen = false, onDownload: (options: DownloadOptions) => { if (this.course) this.library?.enqueue([this.course], options); this.lessonDownloadOpen = false; this.getUIContext().getPromptAction().showToast({ message: '已添加本节课下载任务', duration: 2000 }); } }).width('100%').height('100%').padding({ top: this.safeTop, bottom: this.safeBottom, left: this.safeLeft, right: this.safeRight }) }
    if (this.downloadsOpen) { DownloadSheet({ discoveries: this.downloadDiscovered, discovering: this.downloadScopeChecking, onRefreshScope: () => this.downloadScopeRefresh++, scoped: this.downloadScoped, backSequence: this.downloadBackSequence, fullPage: true, courses: this.downloadCourses, account: this.account, store: this.store, onClose: () => this.downloadsOpen = false, onDownload: (courses: Course[], options: DownloadOptions) => { this.library?.enqueue(courses, options); this.offlineOpen = this.screen === 'home'; } }).width('100%').height('100%').padding({ top: this.safeTop, bottom: this.safeBottom, left: this.safeLeft, right: this.safeRight }).backgroundColor('#F1F3F5') }
    }.width('100%').height('100%').onKeyEvent((event: KeyEvent): boolean => this.keyboard(event)).backgroundColor(this.videoFullscreen ? '#000000' : '#F1F3F5').expandSafeArea([SafeAreaType.SYSTEM], [SafeAreaEdge.TOP, SafeAreaEdge.BOTTOM, SafeAreaEdge.START, SafeAreaEdge.END])
  }
}
