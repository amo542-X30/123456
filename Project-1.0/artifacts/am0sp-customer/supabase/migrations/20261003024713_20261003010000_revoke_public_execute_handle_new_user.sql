-- C3: handle_new_user_settings inherits EXECUTE from PUBLIC.
-- Must revoke from PUBLIC to actually close the hole.
REVOKE EXECUTE ON FUNCTION public.handle_new_user_settings() FROM PUBLIC;
