-- 'inactive' = manually deactivated by a sender (reversible). Kept in its own file because a new enum
-- value cannot be used in the same transaction that creates it.
alter type public.subscriber_status add value if not exists 'inactive';
