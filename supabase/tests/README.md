# アカウント別データ分離の実DB検証

`account-isolation.mjs` は、毎回新しいメモリ内PostgreSQLを作り、`supabase/migrations/*.sql` を名前順に無改変で適用して検証します。外部DBへ接続せず、`.env` も読みません。既存DBの初期化やテスト用アカウントの本番登録は行いません。

このアプリは、1つのDBを共有し、各行の `user_id`（プロフィールは `id`）とRLSでアカウントを分離します。アカウントごとに物理的なDBを作る構成ではありません。

## 再実行

Node.js 20.19.1で確認しています。プロジェクトの依存関係を変えずに実行する場合は、プロジェクトのルートで次を実行します。

```powershell
$isolationRuntime = Join-Path $env:TEMP ('maso-db-isolation-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $isolationRuntime
npm install --prefix $isolationRuntime --no-save --no-package-lock --ignore-scripts --no-audit --no-fund @electric-sql/pglite@0.5.8
node supabase/tests/account-isolation.mjs $isolationRuntime
```

初回のパッケージ取得にはネット接続が必要です。検証の実行自体はローカルで完結します。一時フォルダには検証用パッケージだけが残り、DBは終了時に閉じられます。PGliteをすでに導入している場合は、そのnpm prefixを第1引数へ渡して再利用できます。

最後に次の表示が出れば成功です。失敗した場合は例外と終了コード1を返します。

```text
PASS: 346 PostgreSQL execution checks; no remote database contacted.
```

## 2026年10月5日の結果

**346項目すべて成功。** PostgreSQL 18.3 / PGlite 0.5.8で、SQLの構文、権限、RLS、トリガー、PL/pgSQL関数を実行しました。既存の `supabase/migrations/*.test.ts` はSQL内の文字列を確認するテストですが、このスクリプトはSQLをDBエンジンへ適用し、成功・失敗・返却値・保存状態を確認しています。

適用したファイルのSHA-256は次のとおりです。スクリプトは実行時にもハッシュを表示します。

| migration | SHA-256 |
| --- | --- |
| `0001_initial.sql` | `4746698a8f9dc7880c0fb1b224f3b77c0aa09b1353eff174d98b684bab8dc9a7` |
| `0002_food_item_rpcs.sql` | `8d097b96f77c8cddfa85e930f5064c6e922d1b77b674498e4700f20b84c4a4ce` |
| `0003_load_calculation.sql` | `fb91f1d2f4e8de519274df406b6423dd80e0739c65ebc93efccb3157c34718c7` |
| `0004_display_name_normalization.sql` | `303ea34de18f6dc25c9e60a8b1a03b2eea5f288a67aec28cf797ff54f45d78a2` |
| `0005_name_filter.sql` | `fd896605fb619bcf4ebdec8287796cb4dbc45267ea34c274aaa91beeab33caaa` |
| `0006_workout_edit_delete.sql` | `cc1f14f31470a9180327658718ec4f4924fb2a026f2278d00954c376312868bb` |
| `0007_more_food_items.sql` | `5bdc6252f724dd29a96de15195a2fe48cd7341b109104a05ce5ae58bb98ea1c3` |

2人の新規ユーザーA・Bと未ログインの `anon` を使い、既存ユーザー1人のmigration時の補完も確認しました。A・Bには同じリクエストIDを使い、アカウント間で記録や重複判定が混ざらないことを確認しています。

| 対象 | 自分のデータに対して確認した操作 |
| --- | --- |
| `profiles` | 自動作成、表示名の正規化（ゼロ幅文字・ハングル埋め字・点字空白などの除去）、`update_display_name` による変更、参照。見た目が空白になる名前の拒否、禁止ワードを含む名前の拒否（`name not allowed`）、列の直接更新の禁止 |
| `user_settings` | 自動作成、セット数・単位の参照・変更 |
| `exercises` | 61種目の自動作成（既存ユーザーへの補完とスクワット等の改名を含む）、ユーザー固有の種目ID、`add_exercise` による種目追加（部位による換算パターンの自動判定）、名前変更。直接のINSERTと換算パターンの変更は拒否 |
| `workout_logs` | RPCによる記録作成、4つの換算パターン（自重・アシスト・秒数入力・lb換算）のボリューム計算、入力上限（500kg・200回・30セット・1記録5万kg）の拒否、参照 |
| `body_weight_logs` | 1日1件の体重記録（`save_body_weight` と `save_workout` 経由）、直近体重の自動利用、参照 |
| `maso_status` | 自動作成、ポイント付与、交換時の消費、給餌・レベルアップ・名前変更 |
| `foods` | 自動作成、おにぎり・プロテインの交換・給餌・残数 |
| `food_inventory` | バナナ・ささみ・ステーキの交換・給餌・在庫（直接の書込みは禁止、RPCの結果の `items` で返却）、冪等性、種類の検証 |
| `reward_ledger` | 記録・給餌の台帳作成、記録の編集・削除による調整行（付与済みポイントの合計を基準に再計算し、使用済み分は0未満まで戻さない。下げて上げ直してもポイントを増やせない）、参照 |
| `food_logs` | 種類別の給餌ログ作成、参照 |
| `growth_logs` | レベルアップ時のログ作成、参照 |
| `food_exchange_logs` | 交換ログ作成、参照 |

全12テーブルについて、次の操作が他人のデータへ届かないことを確認しました。

- AからB、BからAへのSELECT・INSERT・UPDATE・DELETEと所有者の付け替え。
- `anon` からのSELECT・INSERT・UPDATE・DELETE。
- 一時的にテーブル権限を広げた場合の、RLS自体による他人へのINSERT・UPDATE・DELETEの遮断。追加権限は検証専用のメモリ内DBでのみ設定し、各確認後にロールバックします。

RPCについても、他人の種目ID、偽造・未指定の `p_expected_user_id`、未ログイン、ユーザーIDのない認証コンテキスト、使用停止した旧RPC、存在しない `p_user_id` 引数を拒否することを確認しました。同じ要求の再送は重複適用せず、再送時の内容変更はエラーになります。他人の種目・記録を結び付ける操作は、複合外部キーでも拒否されました。拒否した操作の前後でA・Bの全データが一致することを最後に照合しています。

## この検証に含まれないもの

PGliteはPostgreSQLのWebAssembly版です。`pgcrypto` を含めた実SQLのローカル実行に使っています。[PGlite公式ドキュメント](https://pglite.dev/docs/)・[拡張機能](https://pglite.dev/extensions/)

この環境ではDocker・psql・Supabase CLIを利用できなかったため、Supabaseサービス一式は起動していません。`auth.users` と `auth.uid()` / `auth.role()` には検証専用の最小実装を用意し、通常ユーザーの操作時はスーパーユーザー権限とRLS迂回権限のない `authenticated` / `anon` へ切り替えています。

そのため、Supabase Authのメール送信、パスワード認証、JWTの署名検証、PostgRESTの公開設定、実Supabaseへのmigration適用、ブラウザから実アカウントを2つ作る一連の操作は未確認です。並列接続による競合・負荷試験も含みません。実Supabase環境の確認時には、環境固有のAuth設定と、適用済みmigrationが上記と一致するかを別途確認してください。
