/**
 * Fixed rules for short videos (ADR 0061) that both the job and the Growth page need. Pure.
 */

/**
 * A dish photo whose short side is below this many pixels is too small for a 1080-wide video: the job
 * skips it and Growth asks for a clearer one. Menu photos (up to 640 px for the till) usually pass; a tiny
 * forwarded picture does not.
 */
export const MIN_VIDEO_PHOTO_PX = 360;
