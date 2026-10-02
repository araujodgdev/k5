import { test } from '@e2e-dev/web';
import { admin, ApiSession } from './support/accounts';
import { signInThroughForm } from './support/sign-in';

// One real sign-in per run; every `{ session: 'admin' }` test restores its cookies and storage,
// including the dismissed onboarding tour.
test.setup('administrador entra pelo formulário', { sessions: ['admin'] }, async ({ app, screen, browser, session }) => {
  await new ApiSession(app.baseUrl!).signIn(admin);
  await signInThroughForm({ app, screen, browser }, admin);
  await session.save('admin');
});
