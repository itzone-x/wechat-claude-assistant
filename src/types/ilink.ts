export interface AccountData {
  token: string;
  uin: string;
  baseUrl: string;
  accountId?: string;
  userId?: string;
  savedAt: string;
}

export interface QRCodeResponse {
  qrcode: string;
  qrcode_img_content: string;
}

export interface QRStatusResponse {
  status?: 'wait' | 'scaned' | 'confirmed' | 'expired';
  bot_token?: string;
  ilink_bot_id?: string;
  baseurl?: string;
  ilink_user_id?: string;
}

export interface WorkerAttachment {
  type: 'image' | 'audio';
  source: 'wechat-upload' | 'image-link';
  filePath: string;
  mimeType?: string;
  fileName?: string;
  originalUrl?: string;
}

export interface WorkerMessage {
  fromUserId: string;
  text: string;
  contextToken: string;
  attachments?: WorkerAttachment[];
}
