import { tutorialModules, tutorialMedia, tutorialDuration } from '@k5/tutorial-library';
import published from '../../public/tutorial/library.json';

export { tutorialDuration };

export function tutorialLibrary({ platformAdmin }: { platformAdmin: boolean }) {
  return tutorialModules
    .filter(module => module.audience === 'everyone' || platformAdmin)
    .map(module => ({ ...module, videos: module.videos.flatMap(video => {
      const asset = published.find(item => item.id === video.id);
      return asset ? [{ ...video, ...asset, media: tutorialMedia(video.id) }] : [];
    }) }))
    .filter(module => module.videos.length > 0);
}
