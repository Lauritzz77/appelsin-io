-- Moderation was never enforced before this change, so existing events were
-- effectively "open" (every upload shown instantly). Normalise the unused
-- 'queue' default to 'open' so behaviour is unchanged; hosts now opt in to the
-- approval queue from the event page.
UPDATE `events` SET `moderation_mode` = 'open' WHERE `moderation_mode` = 'queue';
