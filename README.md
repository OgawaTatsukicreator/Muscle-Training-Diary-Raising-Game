# マソ君の日常

筋トレ記録と2Dキャラクター育成を組み合わせたWebアプリです。重量、回数、セット数からトータルボリュームを計算し、育成ポイントとエサへ換算します。

現在は、ホーム、記録カレンダー、トレーニング入力、履歴分析の主要画面をローカルで一通り試せます。Supabaseの認証とDBスキーマも用意していますが、記録データはまだブラウザの `localStorage` に保存しています。

## 使用技術

- Next.js 16、React 19、TypeScript
- Tailwind CSS 4
- Supabase Auth、PostgreSQL
- Zod
- Vitest

## ローカル起動

Node.js 20.9以上を使います。このリポジトリではNode.js 20.19.1で動作を確認しています。

PowerShellでプロジェクトへ移動し、依存パッケージを入れて起動します。

```powershell
cd "C:\Users\小川樹\Pictures\Saved Pictures\OneDrive\ドキュメント\my AI\筋トレ日記"
npm install
npm run dev
```

ブラウザで [http://localhost:3000](http://localhost:3000) を開きます。Supabaseの環境変数がなくても、ローカルプレビューとして動きます。

## ローカルプレビューの保存先

ローカルプレビューでは、記録、追加した種目、設定、マソ君の状態を現在のブラウザ内に保存します。別の端末や別のブラウザとは共有されません。ブラウザのデータを消すと記録も消えます。

保存キーは `maso-diary:local-preview:v1` です。アプリのホームメニューにある「プレビューデータを消去」から初期状態へ戻せます。

Supabaseの接続情報を設定すると、メールリンク認証と認証必須ページへの制御が有効になります。ただし、現時点の記録、設定、育成状態は引き続きブラウザ内へ保存されます。Supabase DBへの読み書きは次の開発作業です。

## 環境変数

Supabaseへ接続するときは `.env.example` を `.env.local` にコピーします。

```powershell
Copy-Item .env.example .env.local
```

`.env.local` にSupabaseダッシュボードの値を設定します。

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY
NEXT_PUBLIC_APP_VERSION=0.1.0
```

`NEXT_PUBLIC_` が付く値はブラウザへ公開されます。サービスロールキーなどの秘密鍵はここへ入れません。また、`.env.local` はGitへ追加しないでください。

## Supabaseの準備

### 認証URL

Supabaseダッシュボードの認証URL設定に、開発用URLを登録します。

- Site URL：`http://localhost:3000`
- Redirect URL：`http://localhost:3000/auth/callback`

公開時はVercelのURLと、その `/auth/callback` も追加します。ログイン方式はメールへ一度だけ使えるリンクを送る方式です。

### migration

初期スキーマは [`supabase/migrations/0001_initial.sql`](supabase/migrations/0001_initial.sql) にあります。プロフィール、ユーザー設定、種目、トレーニング記録、育成状態、エサ、報酬台帳を作り、RLSとDB関数を設定します。

Supabase CLIを使う場合は、プロジェクトをリンクしてmigrationを適用します。

```powershell
npx supabase init
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push
```

`supabase/config.toml` がすでにある場合、`npx supabase init` は不要です。現在のリポジトリにはまだないため、CLIを初めて使うときに作成します。

CLIを使わない場合は、SupabaseダッシュボードのSQL Editorで `0001_initial.sql` の内容を実行します。同じDBへ何度も手作業で貼り直さず、追加変更は新しいmigrationファイルとして管理してください。

[`supabase/seed.sql`](supabase/seed.sql) は意図的に空です。ユーザー登録時のDBトリガーが、そのユーザー用の設定、マソ君、デフォルト種目を作ります。テストユーザーや本番向けサンプルデータは入れていません。

ローカルSupabaseを使う場合はDocker Desktopを起動してから、次のコマンドでmigrationを適用できます。

```powershell
npx supabase init
npx supabase start
npx supabase db reset
```

## 確認コマンド

```powershell
npm run lint
npm run typecheck
npm test
npm run build
```

2026年7月17日時点で、lint、型チェック、production buildは成功しています。Vitestは4ファイル、18件が成功しました。ブラウザでは、ホームから記録を追加し、カレンダー、育成状態、履歴分析へ反映する流れまで通しています。

## 主な画面

- `/`：マソ君の状態、育成ポイント、エサやり、名前変更
- `/records`：月曜始まりの記録カレンダー、日別記録、設定
- `/records/new?date=YYYY-MM-DD`：部位と種目、重量、回数、セット数の入力
- `/analytics`：直近7日、部位別、種目別のボリューム集計
- `/login`：Supabaseのメールリンク認証

## 設計資料と進捗

- [基本設計書](.docx/基本設計書.md)
- [開発手引き](.docx/開発手引き.md)
- [実装状況](.docx/実装状況.md)

実装済みの範囲と次の作業は `実装状況.md` にまとめています。
