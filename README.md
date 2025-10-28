# Vantanの文化祭メイドカフェ用アプリバックエンド

## 概要
- Cloudflare Workers 上で動作するメイドカフェ運営向けの API サーバーです。
- Hono + hono-openapi による型安全なルーティングと OpenAPI ドキュメントを提供します。
- Drizzle ORM を用いた Cloudflare D1 データベースと、R2 を利用した画像ファイルの保存に対応しています。

## 主な機能
- 稼働状況を確認できるヘルスチェック API を備えており、デプロイ後の監視が容易です。
- メイド情報を登録・更新でき、プロフィール画像を R2 に保存して配信できます。
- メニューの追加・編集・在庫調整に対応し、画像管理も含めて行えます。
- 来場者の入退場、座席割り当て、担当メイド設定などの顧客管理を一元化します。
- 注文を作成し、ペンディングから提供完了までの状態遷移を追跡できます。
- 撮影したインスタント写真をアップロードして管理し、差し替えにも対応しています。
- Swagger UI による API ドキュメントと OpenAPI スキーマを自動生成し、開発・連携を支援します。

## 技術スタック
- Cloudflare Workers / Wrangler
- Hono, hono-openapi, @hono/swagger-ui
- Drizzle ORM (D1 driver)
- Cloudflare R2 ストレージ
- Zod / zod-openapi
- TypeScript

## 前提条件
- Node.js 20 以上と `pnpm`
- Cloudflare アカウントおよび以下のリソース
  - D1 データベース（`vantan_cafe_database` バインディング）
  - R2 バケット（`vantan-cafe-bucket` バインディング）
- Wrangler CLI (`pnpm i -g wrangler` など)

## セットアップ
1. 依存関係をインストールします。
   ```bash
   pnpm install
   ```
2. Drizzle CLI や Wrangler が参照する環境変数を `.env` などに定義します（値は自分のアカウント情報に置き換えてください）。
   ```bash
   CLOUDFLARE_ACCOUNT_ID=<your-account-id>
   CLOUDFLARE_DATABASE_ID=<your-d1-database-id>
   CLOUDFLARE_D1_TOKEN=<token-with-d1-access>
   R2_PUBLIC_BASE_URL=<https://your-r2-public-domain> # オプション
   MAID_API_PASSWORD=<任意の管理用パスワード>
   ```
3. Cloudflare にログインしてバインディングを確認します。
   ```bash
   wrangler login
   wrangler d1 info vantan_cafe_database
   wrangler r2 bucket list
   ```

## 開発・デプロイコマンド
| コマンド | 説明 |
| --- | --- |
| `pnpm dev` | `wrangler dev` を使ったローカル開発サーバーを起動します（デフォルトで <http://localhost:8787>）。 |
| `pnpm deploy` | Cloudflare Workers にデプロイします（`--minify` オプション付き）。 |
| `pnpm cf-typegen` | Cloudflare Bindings の型定義を再生成します。 |

開発サーバー起動後、`http://localhost:8787/docs` にアクセスすると Swagger UI が表示され、API の詳細を確認できます。

## データベースとマイグレーション
- スキーマは `drizzle/schema.ts` に定義されています。
- マイグレーションファイルは `drizzle/migrations/` に生成されます（`drizzle.config.ts` を参照）。
- 新しいマイグレーションを作成する場合は以下のように実行します。
  ```bash
  pnpm drizzle-kit generate
  ```
- 適用は Wrangler 経由で行います。
  ```bash
  wrangler d1 migrations apply vantan_cafe_database
  ```

## ストレージ（R2）
- 画像ファイルは R2 (`vantan-cafe-bucket`) に保存されます。
- `R2_PUBLIC_BASE_URL` を設定すると、API から返される画像 URL が公開ドメインに変換されます。設定しない場合は R2 の内部キーがそのまま返却されます。

## ディレクトリ構成（抜粋）
```
src/
  index.ts             # ルートエントリ、各ルートを登録
  routes/              # ドメインごとの API ルート実装
  docs/                # OpenAPI 生成に関する設定とルート
  libs/                # DB, ストレージ, スキーマ共通ユーティリティ
drizzle/
  schema.ts            # D1 スキーマとリレーション定義
  migrations/          # 生成されたマイグレーション
```

## 補足
- 画像アップロード系エンドポイントでは multipart/form-data を利用します。`FormData` を用いたアップロード例は Swagger UI から確認できます。
- 認証が必要なエンドポイントを追加する場合は、`MAID_API_PASSWORD` や Cloudflare Access などを組み合わせることを想定しています。
