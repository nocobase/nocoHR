import { resolveAppUrl, useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { useEffect, useRef, useState, type ReactElement } from 'react';

import type { LearnerCourse } from '@/components/talent/learning-types';
import { Progress } from '@/components/ui/progress';

type LearnerLesson = LearnerCourse['lessons'][number];

/** m:ss */
function clock(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
}

/** Reports are sent this often while the video plays. */
const REPORT_EVERY_MS = 10_000;
/** How far past the furthest watched position the learner may seek. */
const SEEK_AHEAD_SECONDS = 5;
const MAX_RATE = 1.5;

/**
 * A video lesson counted by what was actually watched: seeking is limited to
 * a few seconds beyond the furthest position reached, playback speed to 1.5×,
 * and the played interval is reported every 10 seconds. The server merges the
 * intervals and bounds each by the time since the previous report, so it — not
 * this player — decides when "complete this lesson" is allowed.
 */
export function VideoLesson({
  courseId,
  lesson,
  onProgress,
}: {
  courseId: string;
  lesson: LearnerLesson;
  onProgress: (state: { watchedSeconds: number; canComplete: boolean }) => void;
}): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const video = useRef<HTMLVideoElement>(null);
  const furthest = useRef(lesson.maxPositionSeconds);
  const segmentStart = useRef<number | null>(null);
  const [watched, setWatched] = useState(lesson.watchedSeconds);
  const duration = lesson.videoSeconds ?? 0;
  const required = Math.ceil((duration * lesson.minWatchPercent) / 100);

  async function report(): Promise<void> {
    const element = video.current;
    if (!element || segmentStart.current === null) return;
    const from = segmentStart.current;
    const to = element.currentTime;
    segmentStart.current = element.paused ? null : to;
    if (to - from < 0.5) return;
    try {
      const result = await api.request<{
        data: {
          watchedSeconds: number;
          maxPositionSeconds: number;
          canComplete: boolean;
        };
      }>({
        path: 'talent/learning/video-progress',
        method: 'POST',
        json: { courseId, lessonId: lesson.id, from, to },
      });
      furthest.current = Math.max(
        furthest.current,
        result.data.maxPositionSeconds,
      );
      setWatched(result.data.watchedSeconds);
      onProgress(result.data);
    } catch {
      // A missed report only delays progress; the next one covers the interval again.
    }
  }

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (video.current && !video.current.paused) void report();
    }, REPORT_EVERY_MS);
    return () => {
      window.clearInterval(timer);
      void report();
    };
    // `report` reads refs only; re-creating the interval on every render would reset it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lesson.id]);

  return (
    <div className='space-y-3'>
      <video
        ref={video}
        className='aspect-video w-full rounded-lg bg-muted'
        src={resolveAppUrl(
          `api/talent/learning/lessons/${encodeURIComponent(lesson.id)}/video`,
        )}
        controls
        controlsList='nodownload noplaybackrate'
        disablePictureInPicture
        preload='metadata'
        onPlay={(event) => {
          segmentStart.current = event.currentTarget.currentTime;
        }}
        onPause={() => void report()}
        onEnded={() => void report()}
        onSeeking={(event) => {
          const element = event.currentTarget;
          const limit = furthest.current + SEEK_AHEAD_SECONDS;
          if (element.currentTime > limit)
            element.currentTime = furthest.current;
          // A seek starts a new interval; the one before it was reported as it ended.
          segmentStart.current = element.paused ? null : element.currentTime;
        }}
        onTimeUpdate={(event) => {
          const now = event.currentTarget.currentTime;
          // Playing forward extends what may be sought to; the server still decides what counts.
          if (now > furthest.current && now - furthest.current < 2)
            furthest.current = now;
        }}
        onRateChange={(event) => {
          if (event.currentTarget.playbackRate > MAX_RATE)
            event.currentTarget.playbackRate = MAX_RATE;
        }}
      />
      <div className='space-y-1'>
        <Progress
          value={duration ? Math.min((watched / duration) * 100, 100) : 0}
          aria-label={t('talent.video.watched')}
        />
        <p className='text-xs text-muted-foreground tabular-nums'>
          {t('talent.video.watchedValue', {
            watched: clock(watched),
            required: clock(required),
            percent: lesson.minWatchPercent,
          })}
        </p>
        <p className='text-xs text-muted-foreground'>
          {t('talent.video.rules')}
        </p>
      </div>
    </div>
  );
}
