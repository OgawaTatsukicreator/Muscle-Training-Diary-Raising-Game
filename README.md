# マソ君の日常

## 概要

筋トレの記録を続けながら、2Dキャラクター「マソ君」を育てるWebアプリです。重量・回数・セット数からトレーニング量を計算し、育成ポイントを獲得できます。ポイントをエサに交換してマソ君にあげると、成長します。

主な機能は、トレーニングの登録、カレンダーでの記録確認、履歴の分析、エサの交換・給餌、BGMの再生です。Supabaseを設定すると、メールアドレスで登録・ログインし、自分のデータをクラウドに保存できます。設定しなくても、ブラウザ内に保存するローカルプレビューを試せます。

Next.js 16、React 19、TypeScript、Tailwind CSS 4、Supabaseを使用しています。

## インストール

1. Node.js 20.9以上を用意し、このフォルダーで依存パッケージをインストールします。

   ```powershell
   npm ci
   ```

2. ローカルプレビューだけを使う場合、追加設定は不要です。アカウント登録とクラウド保存を使う場合は、設定例をコピーしてSupabaseの公開用接続情報を入力します。

   ```powershell
   Copy-Item .env.example .env.local
   ```

   ```dotenv
   NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY
   NEXT_PUBLIC_APP_VERSION=0.1.0
   ```

   `.env.local` はGitに追加しないでください。`NEXT_PUBLIC_` で始まる値はブラウザへ公開されるため、サービスロールキーなどの秘密情報は設定しません。

### Supabaseを使う場合の初期設定

SupabaseのAuthenticationでメールとパスワードによる登録を有効にし、開発用の **Site URL** を `http://localhost:3000`、**Redirect URL** を `http://localhost:3000/auth/callback` に設定します。公開時は公開先のURLとその `/auth/callback` も追加します。メール確認を有効にした場合、登録後に届くリンクを開く必要があります。

データベースには `supabase/migrations/0001_initial.sql`、`0002_food_item_rpcs.sql` を順番に適用します。Supabase CLIを使う場合の例です。

```powershell
npx supabase init
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push
```

既に `supabase/config.toml` がある場合、`npx supabase init` は不要です。CLIを使わない場合はSupabaseのSQL Editorで2つのSQLファイルを番号順に実行できます。初期データは登録時のデータベース処理が作成するため、`supabase/seed.sql` は空です。公開環境で一般ユーザーを登録させる場合は、Supabase標準の送信制限を踏まえ、AuthenticationのSMTP設定も行ってください。

## 使い方

1. 開発サーバーを起動し、ブラウザで [http://localhost:3000](http://localhost:3000) を開きます。

   ```powershell
   npm run dev
   ```

2. **記録**画面で日付を選び、部位・種目・重量・回数・セット数を入力します。**ホーム**で育成ポイントを確認し、「エサやり」からエサに交換してマソ君にあげます。**履歴分析**では直近7日、部位別、種目別のトレーニング量を確認できます。Supabaseを設定した場合、初回は案内画面からアカウントを登録し、以後はログインして使います。

3. 計算例として、60 kgを10回、3セット記録した場合は次のようになります。

   ```ts
   const volumeKg = 60 * 10 * 3; // 1,800 kg
   const growthPoints = Math.floor(volumeKg / 100); // 18ポイント
   ```

   おにぎりは1個5ポイント、プロテインは1個15ポイントで交換できます。1回の交換・給餌は1〜1,000個です。

### 画面と保存先

| 画面 | パス | できること |
| --- | --- | --- |
| ホーム | `/` | マソ君の状態確認、エサの交換・給餌、名前変更 |
| 記録 | `/records` | カレンダーと日別記録の確認 |
| 入力 | `/records/new?date=YYYY-MM-DD` | トレーニングの登録 |
| 履歴分析 | `/analytics` | トレーニング量の集計 |
| 登録・ログイン | `/welcome`、`/register`、`/login` | アカウントの作成とログイン |

Supabaseに接続してログインした場合、記録・種目・設定・マソ君の状態はアカウントごとに保存されます。ローカルプレビューでは現在のブラウザの `localStorage` に保存され、別のブラウザや端末には引き継がれません。ブラウザのデータを消すと記録も消えます。プレビューデータはログイン時に自動でクラウドへ移行しないため、必要な記録は事前に控えてください。

BGMは画面上部や設定から曲・音量・再生状態を変更できます。ブラウザの自動再生制限により、最初のクリックやタップ後に再生される場合があります。BGMの設定はブラウザごとに保存され、アカウント間では同期しません。

## 運用

1. 変更を提案する場合は、このリポジトリをフォークして作業ブランチを作成します。
2. 変更後に次のコマンドで確認します。

   ```powershell
   npm run lint
   npm run typecheck
   npm test
   npm run build
   ```

3. 変更内容と確認結果を記載してプルリクエストを送信します。本番向けの動作確認では、Supabaseの認証URL、メール設定、migrationの適用状態も確認してください。

設計と開発の詳細は [要件定義書](.docx/要件定義書.md)、[基本設計書](.docx/基本設計書.md)、[開発手引き](.docx/開発手引き.md) を参照してください。[実装状況](.docx/実装状況.md) は記載日時の時点の記録です。アカウントごとのデータ分離テストの手順と検証範囲は [検証資料](supabase/tests/README.md) にあります。

## ライセンス

プロジェクト本体のライセンスは、現時点で指定されていません。再利用・再配布の条件はリポジトリ管理者に確認してください。同梱BGMはCC0 1.0で公開された音源です。出典と加工内容は [音源クレジット](public/audio/bgm/CREDITS.md)、ライセンス本文は [CC0 1.0](public/audio/bgm/CC0-1.0.txt) を参照してください。

## 更新履歴

- 2026/09/29: READMEを初めて使う人向けに再構成し、検証で生じたファイルを整理。
- 2026/09/06: 初回登録の導線と、アカウント別データ分離の検証を追加。
