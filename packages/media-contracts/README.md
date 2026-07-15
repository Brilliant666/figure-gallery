# media-contracts

本目录预留给框架无关的媒体协议，包括稳定 `storageKey`、对象 manifest、原图/派生图描述、尺寸、MIME、SHA-256 与感知哈希字段语义。

PR-00 只建立边界说明：这里没有存储 adapter、上传实现、媒体文件或 package manifest。公开 URL、签名 URL、CDN URL 与 S3 endpoint 不得成为业务身份；正式媒体生命周期只能在后续获授权的 PR 中实现。
