# マソ君の日常

筋トレ記録と2Dキャラクター育成を組み合わせたWebアプリです。重量、回数、セット数からトータルボリュームを計算し、育成ポイントとエサへ換算します。

ホーム、記録カレンダー、トレーニング入力、履歴分析の主要画面を利用できます。Supabaseへ接続すると、アカウント作成・ログインと、ユーザーごとに分離されたクラウド保存が有効になります。接続情報がない開発環境では、引き続きブラウザの `localStorage` でプレビューできます。

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

## データの保存先

Supabaseへ接続してログインした場合は、記録、追加した種目、設定、マソ君の状態をログイン中のアカウントへ保存します。RLSにより、別のアカウントのデータは読み書きできません。

Supabase未接続のローカルプレビューでは、同じ内容を現在のブラウザ内だけに保存します。別の端末や別のブラウザとは共有されません。ブラウザのデータを消すと記録も消えます。

保存キーは `maso-diary:local-preview:v1` です。アプリのホームメニューにある「プレビューデータを消去」から初期状態へ戻せます。

ローカルプレビューのデータは、ログイン時に自動でクラウドへ移行しません。必要な記録は、接続前に控えておいてください。

## 初回登録

Supabaseへ接続済みのアプリを未ログインで開くと、`/welcome` の初回案内画面が表示されます。「初回登録してはじめる」から表示名・メールアドレス・パスワードを入力します。メール確認が有効な場合は、登録したブラウザで確認メールのリンクを開いてください。登録済みの方は案内画面から「ログイン」を選びます。ログイン状態が有効な間は、初回案内・登録画面を再表示せず、自分の記録へ移動します。

登録時には、アカウント専用のプロフィール、記録の設定、マソ君、エサ残数、デフォルト14種目をDBトリガーが作成します。アカウントごとに物理的なDBを増やす方式ではなく、1つのDB内でユーザーIDとRLSにより分離します。BGMの設定だけは従来どおりブラウザ単位です。

この分離は、独立したPostgreSQLへ実際のmigrationを適用し、2ユーザーと未ログイン利用者による213項目の実行テストで確認しています。全10テーブルのRLS、他人のデータへの読み書き拒否、登録時の初期データ生成、記録・交換・給餌の所有権を検証しました。結果・再実行手順・実Supabaseでは未確認の範囲は [アカウント別データ分離の検証](supabase/tests/README.md) を参照してください。

入力エラーは該当欄へ移動して案内し、登録の二重送信を防ぎます。登録制限・確認メールの送信制限・通信失敗の案内も表示します。

## エサのまとめ交換とBGM

ホームの「エサやり」から「アイテム交換」を選び、種類と個数を指定します。＋／−、数値入力、「最大」で個数を変更でき、確認画面で合計ポイントと交換後の所持数を確認できます。一度に交換・給餌できる数は1〜1000個で、ポイントや所持数を超える操作はできません。

BGMは全画面共通でループ再生し、画面を移動しても再生を継続します。ホームメニューと記録画面の設定から、5曲の選択・音量変更・再生停止ができます。画面上部にも再生／停止ボタンがあります。ブラウザが自動再生を制限する場合は、最初のクリックやタップ、または「BGM再生」操作後に始まります。端末の消音設定やバックグラウンド制限により、常に音が出ることは保証できません。

曲・音量・停止状態は `maso-diary:bgm:v1` としてこのブラウザに保存し、アカウント間・端末間では同期しません。音源はJuhani Junkala氏がCC0で公開した5曲を同梱しています。配布元・原題・加工内容は [音源クレジット](public/audio/bgm/CREDITS.md)、ライセンス本文は [CC0 1.0](public/audio/bgm/CC0-1.0.txt) を参照してください。

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

公開時はVercelのURLと、その `/auth/callback` も追加します。ログイン方式はメールアドレスとパスワードです。新規登録時のメール確認を有効にする場合、確認メールは `/auth/callback` へ戻ります。

Supabase標準のメール送信には厳しい制限があります。組織メンバー以外も登録する本番環境では、AuthenticationのSMTP設定に独自のメール配信サービスを設定してください。

### migration

初期スキーマは [`supabase/migrations/0001_initial.sql`](supabase/migrations/0001_initial.sql) にあります。続くmigrationで、2種類のエサ、ポイント交換、種類別のエサやりを追加します。プロフィール、ユーザー設定、種目、トレーニング記録、育成状態、エサ、報酬台帳を作り、RLSとDB関数を設定します。

Supabase CLIを使う場合は、プロジェクトをリンクしてmigrationを適用します。

```powershell
npx supabase init
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push
```

`supabase/config.toml` がすでにある場合、`npx supabase init` は不要です。現在のリポジトリにはまだないため、CLIを初めて使うときに作成します。

CLIを使わない場合は、SupabaseダッシュボードのSQL Editorで `0001_initial.sql`、`0002_food_item_rpcs.sql` の順に内容を実行します。どちらか一方だけではクラウド保存は動きません。同じDBへ何度も手作業で貼り直さず、追加変更は新しいmigrationファイルとして管理してください。

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

2026年9月6日時点で、lint、型チェック、Vitest 11ファイル・129件は成功しています。通常の `.next` はOneDriveにロックされていたため、実環境の設定を含めない一時コピーで `next build --webpack` を実行し、本番ビルドと10ページの生成成功を確認しました。

初回案内から登録・ログインへの移動、入力検証とフォーカス移動、パスワード表示切り替え、処理中の二重送信防止、送信制限後の再試行、確認メール案内を390px幅のブラウザで確認しました。ブラウザ検証では登録APIを模擬しており、実アカウントや確認メールは作成・送信していません。接続先SupabaseのAuth設定は読み取り確認し、メール登録が有効で、メール確認が必要な設定でした。実Supabaseでの登録からログインまでの確認は未実施です。

ブラウザでは、ローカルプレビューで2種類の複数交換、合計ポイント・所持数の反映、残高不足、最大1000個の制限、複数給餌と保存を確認しています。BGMは5曲の実再生・ループ、選曲・音量・停止状態の保存、ホームと記録画面を移動した際の再生継続を確認しました。スマートフォン幅でも確認済みです。実Supabaseでの今回の交換操作とiOS実機の音声再生は未確認です。実Supabaseを使う準備手順は上の「Supabaseの準備」を参照してください。

## 主な画面

- `/`：マソ君の状態、育成ポイント、エサやり、名前変更
- `/records`：月曜始まりの記録カレンダー、日別記録、設定
- `/records/new?date=YYYY-MM-DD`：部位と種目、重量、回数、セット数の入力
- `/analytics`：直近7日、部位別、種目別のボリューム集計
- `/login`：登録済みアカウントのログイン・ログアウト
- `/welcome`：初回登録・ログインの入口
- `/register`：初回のアカウント作成

## 設計資料と進捗

- [基本設計書](.docx/基本設計書.md)
- [開発手引き](.docx/開発手引き.md)
- [実装状況](.docx/実装状況.md)

実装済みの範囲と次の作業は `実装状況.md` にまとめています。
