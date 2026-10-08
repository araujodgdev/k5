import { officePage } from '@/components/lume/canvas-leaf';
import { redirect } from 'next/navigation';

/** Feedback became a dialog in the navigation; old links open it on the person's reports. */
function FeedbackPage() { return redirect('/app/command-center?feedback=relatos'); }

export default officePage('/app/feedback', FeedbackPage);
