// 兼容旧资料的纯身份逻辑，与具体存储技术无关。
export const profileKey = (record: { profileId?: string; id: string }) => record.profileId ?? `legacy:${record.id}`
export const recordProfileKey = (record: { profileId?: string; bossId: string }) => record.profileId ?? `legacy:${record.bossId}`
