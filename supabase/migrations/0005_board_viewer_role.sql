-- New role for board members who may see history and statistics but never send or edit.
-- Own file: a new enum value cannot be used in the transaction that creates it.
alter type public.member_role add value if not exists 'board_viewer';
