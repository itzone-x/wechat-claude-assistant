export interface ILinkConfig {
  baseUrl: string;
  cdnUrl: string;
  tokenPath: string;
}

export interface ILinkAuth {
  token: string;
  uin: string;
  getUpdatesBuf?: string;
}

export interface ILinkMessage {
  msgId: string;
  fromUser: string;
  content: string;
  contextToken: string;
  msgType: 'text' | 'image' | 'video' | 'file';
  mediaUrl?: string;
}

export interface ILinkResponse<T = any> {
  ret: number;
  errcode?: number;
  errmsg?: string;
  data?: T;
}
