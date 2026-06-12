import { createEntity } from './store'

export const AuthUsers = createEntity('AuthUsers')
export const UserProfiles = createEntity('UserProfiles')

export const AdsPerformanceDaily = createEntity('AdsPerformanceDaily')
export const AdsPerformanceAgg = createEntity('AdsPerformanceAgg')
export const AdStats = createEntity('AdStats')
export const AdScriptMapping = createEntity('AdScriptMapping')
export const SyncRuns = createEntity('SyncRuns')

export const VideoAssets = createEntity('VideoAssets')
export const VideoAnnotations = createEntity('VideoAnnotations')
export const Tasks = createEntity('Tasks')
export const EditorQueue = createEntity('EditorQueue')

export const AvatarProfiles = createEntity('AvatarProfiles')
export const AngleLibrary = createEntity('AngleLibrary')
export const DesireLibrary = createEntity('DesireLibrary')
export const ProblemLibrary = createEntity('ProblemLibrary')
export const ObjectionLibrary = createEntity('ObjectionLibrary')
export const ScriptLibrary = createEntity('ScriptLibrary')
export const GeneratedScripts = createEntity('GeneratedScripts')
export const ScriptBuilderDrafts = createEntity('ScriptBuilderDrafts')
export const InspirationAds = createEntity('InspirationAds')
export const PatternFindings = createEntity('PatternFindings')
export const ScriptModules = createEntity('ScriptModules')

export const Settings = createEntity('Settings')
export const PageGuides = createEntity('PageGuides')
export const NotificationsLog = createEntity('NotificationsLog')
export const MarketResearchRuns = createEntity('MarketResearchRuns')
export const TrainingResources = createEntity('TrainingResources')

export const BonusRules = createEntity('BonusRules')
export const BonusPeriods = createEntity('BonusPeriods')
export const BonusLedger = createEntity('BonusLedger')
export const BonusAdjustments = createEntity('BonusAdjustments')

export async function getSettings() {
  const all = await Settings.list()
  return all.find((s) => s.singleton === 'main') || all[0] || null
}

// Mock signed URL service (Base44 CreateFileSignedUrl equivalent)
export async function CreateFileSignedUrl(uri) {
  return { signed_url: uri, expires_in: 3600 }
}
