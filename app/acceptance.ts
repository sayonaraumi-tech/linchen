import {FirebaseError} from 'firebase/app';
import {initializeApp, type FirebaseOptions} from 'firebase/app';
import {
  connectAuthEmulator, getAuth, inMemoryPersistence, onAuthStateChanged, setPersistence,
  signInWithEmailAndPassword, signOut, getMultiFactorResolver, multiFactor, TotpMultiFactorGenerator,
  sendEmailVerification, sendPasswordResetEmail, type MultiFactorError, type MultiFactorResolver, type TotpSecret, type User,
} from 'firebase/auth';

type RecordPayload = {id: string} & Record<string, unknown>;
type State = {collections: Record<string, Record<string, RecordPayload>>};
type Workspace = {state: State; revision: number | null; role: 'admin' | 'staff'};
type Command = {type: string; operationId: string} & Record<string, unknown>;
type Configuration = {firebase: FirebaseOptions; authEmulator: string | null; cloud: boolean};

const login = document.querySelector<HTMLElement>('#login')!;
const workspace = document.querySelector<HTMLElement>('#workspace')!;
const signInForm = document.querySelector<HTMLFormElement>('#sign-in')!;
const signOutButton = document.querySelector<HTMLButtonElement>('#sign-out')!;
const connection = document.querySelector<HTMLElement>('#connection')!;
let user: User | null = null;
let current: Workspace | null = null;
let synchronizing = false;
const pending = new Map<string, {payload: string; request: string}>();

class ApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

async function api(path: string, options: RequestInit = {}) {
  const actor = user;
  if (!actor) throw Error('ログインしてください');
  const token = await actor.getIdToken();
  if (actor !== user) throw Error('再度ログインしてください');
  const headers = new Headers(options.headers);
  headers.set('Authorization', 'Bearer ' + token);
  const response = await fetch(path, {...options, headers, cache: 'no-store',
    signal: AbortSignal.timeout(path.startsWith('/api/pdf') ? 40_000 : 15_000)});
  if (actor !== user) throw Error('再度ログインしてください');
  if (!response.ok) {
    const detail = await response.json().catch(() => ({})) as {message?: string};
    const message = response.status === 409 ? '別の端末で変更されました。最新の記録を再読込してください' :
      response.status === 403 ? 'この会社の操作権限がありません' : '処理できませんでした。通信状態と入力を確認してください';
    throw new ApiError(detail.message || message, response.status);
  }
  return response;
}

async function refresh() {
  const actor = user;
  if (!actor || synchronizing) return;
  if (!navigator.onLine) {
    connection.textContent = 'オフラインです。再接続するまで変更を保存できません。';
    return;
  }
  synchronizing = true;
  try {
    const next = await (await api('/api/workspace')).json() as Workspace;
    if (actor !== user) return;
    const changed = !current || current.revision !== next.revision || (next.revision === null &&
      JSON.stringify(current.state) !== JSON.stringify(next.state));
    const first = !current;
    // Leave an edited form and its revision in place until the user reloads or submits.
    if (changed && !first && workspace.dataset.editing === 'true') {
      connection.textContent = '別の端末の更新があります。入力中の内容を確認して再読込してください。';
      return;
    }
    current = next;
    login.hidden = true;
    workspace.hidden = false;
    connection.textContent = '';
    if (changed) document.dispatchEvent(new Event('linchen-refresh'));
  } catch (error) {
    if (actor !== user) return;
    if (error instanceof ApiError && [401, 403].includes(error.status)) clearWorkspace();
    connection.textContent = error instanceof Error ? error.message : 'データを取得できません';
  } finally {
    synchronizing = false;
  }
}

function clearWorkspace() {
  current = null;
  pending.clear();
  workspace.hidden = true;
  delete workspace.dataset.editing;
  document.querySelector('#page')?.replaceChildren();
  document.querySelector('#status')?.replaceChildren();
  document.querySelectorAll('dialog').forEach(dialog => dialog.remove());
  document.dispatchEvent(new Event('linchen-clear'));
}

const runtime = {
  snapshot() { return current?.state; },
  canWrite() { return current?.role === 'admin'; },
  markEditing() { workspace.dataset.editing = 'true'; },
  async refresh() {
    delete workspace.dataset.editing;
    await refresh();
  },
  async perform(command: Command) {
    if (!navigator.onLine) throw Error('オフラインです。再接続後に再試行してください');
    if (current?.revision == null) throw Error('変更する権限がありません');
    const payload = JSON.stringify(command);
    const previous = pending.get(command.operationId);
    if (previous && previous.payload !== payload) throw Error('保存状態を確認してから入力を変更してください');
    const request = previous?.request || JSON.stringify({...command, expectedRevision: current.revision,
      expiresAt: Date.now() + 10 * 60_000});
    pending.set(command.operationId, {payload, request});
    let result: unknown;
    try {
      result = await (await api('/api/commands', {method: 'POST', headers: {'Content-Type': 'application/json'},
        body: request})).json();
      pending.delete(command.operationId);
    } catch (error) {
      if (error instanceof ApiError && error.status < 500) pending.delete(command.operationId);
      throw error;
    }
    await runtime.refresh();
    return result;
  },
  pdf(id: string) {
    return api('/api/pdf?id=' + encodeURIComponent(id), {method: current?.role === 'admin' ? 'POST' : 'GET'});
  },
};

Object.assign(window, {LinchenAcceptance: runtime});

async function boot() {
  const response = await fetch('/configuration.json');
  if (!response.ok) throw Error('接続設定を取得できません');
  const config = await response.json() as Configuration;
  const auth = getAuth(initializeApp(config.firebase));
  if (config.authEmulator) connectAuthEmulator(auth, config.authEmulator, {disableWarnings: true});
  await setPersistence(auth, inMemoryPersistence);
  const verification = document.querySelector<HTMLButtonElement>('#verify-email')!;
  const enrollment = document.querySelector<HTMLElement>('#mfa-enrollment')!;
  const startEnrollment = document.querySelector<HTMLButtonElement>('#start-enrollment')!;
  const confirmEnrollment = document.querySelector<HTMLFormElement>('#confirm-enrollment')!;
  const enrollmentKey = document.querySelector<HTMLInputElement>('#enrollment-key')!;
  const secondFactor = document.querySelector<HTMLFormElement>('#mfa-sign-in')!;
  const passwordReset = document.querySelector<HTMLButtonElement>('#password-reset')!;
  let resolver: MultiFactorResolver | null = null;
  let secret: TotpSecret | null = null;
  let mfaPending = false;
  passwordReset.hidden = !config.cloud;
  onAuthStateChanged(auth, async next => {
    clearWorkspace();
    user = next;
    secret = null;
    enrollmentKey.value = '';
    enrollment.hidden = true;
    confirmEnrollment.hidden = true;
    secondFactor.hidden = true;
    signInForm.hidden = false;
    mfaPending = false;
    login.hidden = Boolean(next);
    signOutButton.hidden = !next;
    if (!next) return;
    try {
      if (config.cloud) {
        const {claims, signInSecondFactor} = await next.getIdTokenResult();
        if (next !== user) return;
        if (claims.role === 'admin' && (!next.emailVerified || signInSecondFactor !== 'totp')) {
          mfaPending = true;
          enrollment.hidden = false;
          verification.hidden = next.emailVerified;
          startEnrollment.hidden = !next.emailVerified || multiFactor(next).enrolledFactors.length > 0;
          connection.textContent = next.emailVerified ?
            '認証アプリで二段階認証を設定してください。設定済みの場合は再ログインしてください。' :
            'メールアドレスを確認し、再度ログインしてください。';
          return;
        }
      }
      await refresh();
    } catch {
      connection.textContent = 'セッションを確認できません。再度ログインしてください。';
    }
  });

  function code(form: HTMLFormElement) { return String(new FormData(form).get('code')); }

  signInForm.addEventListener('submit', async event => {
    event.preventDefault();
    const data = new FormData(signInForm);
    const submit = signInForm.querySelector<HTMLButtonElement>('button')!;
    submit.disabled = true;
    try {
      await signInWithEmailAndPassword(auth, String(data.get('email')), String(data.get('password')));
      signInForm.reset();
    } catch (error) {
      if (error instanceof FirebaseError && error.code === 'auth/multi-factor-auth-required') {
        resolver = getMultiFactorResolver(auth, error as MultiFactorError);
        signInForm.reset();
        signInForm.hidden = true;
        secondFactor.hidden = false;
        connection.textContent = '認証アプリのコードを入力してください。';
      } else {
        connection.textContent = 'ログインできません。入力内容と接続状態を確認してください。';
      }
    } finally {
      submit.disabled = false;
    }
  });
  secondFactor.addEventListener('submit', async event => {
    event.preventDefault();
    const hint = resolver?.hints.find(item => item.factorId === TotpMultiFactorGenerator.FACTOR_ID);
    if (!resolver || !hint) return;
    try {
      await resolver.resolveSignIn(TotpMultiFactorGenerator.assertionForSignIn(hint.uid, code(secondFactor)));
      secondFactor.reset();
      resolver = null;
    } catch {
      connection.textContent = '認証コードを確認してください。';
    }
  });
  passwordReset.addEventListener('click', async () => {
    const email = signInForm.querySelector<HTMLInputElement>('[name=email]')!;
    if (!email.reportValidity()) return;
    try {
      await sendPasswordResetEmail(auth, email.value);
    } catch {
      // A generic response prevents the UI from revealing account membership.
    }
    connection.textContent = '登録済みの場合、パスワード設定メールが届きます。';
  });
  verification.addEventListener('click', async () => {
    if (!user) return;
    try {
      await sendEmailVerification(user);
      connection.textContent = 'メールを確認し、ログアウト後に再ログインしてください。';
    } catch {
      connection.textContent = 'メールを送信できませんでした。時間をおいて再試行してください。';
    }
  });
  startEnrollment.addEventListener('click', async () => {
    const actor = user;
    if (!actor || !actor.emailVerified) return;
    try {
      const generated = await TotpMultiFactorGenerator.generateSecret(await multiFactor(actor).getSession());
      if (actor !== user) return;
      secret = generated;
      enrollmentKey.value = generated.secretKey;
      confirmEnrollment.hidden = false;
    } catch {
      connection.textContent = '二段階認証を開始できませんでした。再ログインしてください。';
    }
  });
  confirmEnrollment.addEventListener('submit', async event => {
    event.preventDefault();
    if (!user || !secret) return;
    try {
      await multiFactor(user).enroll(TotpMultiFactorGenerator.assertionForEnrollment(secret, code(confirmEnrollment)), 'Linchen');
      confirmEnrollment.reset();
      await signOut(auth);
      connection.textContent = '登録しました。認証アプリを使用して再ログインしてください。';
    } catch {
      connection.textContent = '認証コードを確認してください。';
    }
  });
  signOutButton.addEventListener('click', () => { void signOut(auth); });
  window.addEventListener('online', () => { if (!mfaPending) void refresh(); });
  window.addEventListener('offline', () => {
    if (user) connection.textContent = 'オフラインです。再接続するまで変更を保存できません。';
  });
  setInterval(() => { if (!document.hidden && !mfaPending) void refresh(); }, config.cloud ? 30000 : 5000);
  signInForm.querySelector<HTMLButtonElement>('button[type=submit]')!.disabled = false;
}

document.querySelector<HTMLSelectElement>('#theme')!.addEventListener('change', event => {
  document.documentElement.dataset.theme = (event.currentTarget as HTMLSelectElement).value;
});
void boot().catch(() => { connection.textContent = '認証サービスに接続できません。'; });
