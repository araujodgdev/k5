import { redirect } from 'next/navigation';

/** Feedback became a dialog in the navigation; old links open it on the person's reports. */
export default function FeedbackPage() { redirect('/app/command-center?feedback=relatos'); }
