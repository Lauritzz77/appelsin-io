// Compile-time only — imported nowhere at runtime (tree-shaken from the build, but
// still type-checked by `astro check` via tsconfig `include`). Each `satisfies`
// forces the English JSON to structurally match the Danish (canonical) shape, so
// renaming or dropping a key in cms/da/*.json fails the type-check until the matching
// cms/en/*.json is updated. Add one line per namespace.
import type { Content } from './content'
import enCommon from '@cms/en/common.json'
import enHome from '@cms/en/home.json'
import enLogin from '@cms/en/login.json'
import enGuestEntry from '@cms/en/guest-entry.json'
import enLegal from '@cms/en/legal.json'
import enDashboard from '@cms/en/dashboard.json'
import enBilling from '@cms/en/billing.json'
import enEventNew from '@cms/en/event-new.json'
import enGuestUpload from '@cms/en/guest-upload.json'
import enStyleEditor from '@cms/en/style-editor.json'
import enDisplay from '@cms/en/display.json'
import enGallery from '@cms/en/gallery.json'
import enEventDetail from '@cms/en/event-detail.json'

enCommon satisfies Content<'common'>
enHome satisfies Content<'home'>
enLogin satisfies Content<'login'>
enGuestEntry satisfies Content<'guest-entry'>
enLegal satisfies Content<'legal'>
enDashboard satisfies Content<'dashboard'>
enBilling satisfies Content<'billing'>
enEventNew satisfies Content<'event-new'>
enGuestUpload satisfies Content<'guest-upload'>
enStyleEditor satisfies Content<'style-editor'>
enDisplay satisfies Content<'display'>
enGallery satisfies Content<'gallery'>
enEventDetail satisfies Content<'event-detail'>
