-- ============================================================
-- C1: Revoke anon/authenticated access to passkey_challenges
-- This table is only accessed by the service-role edge function.
-- ============================================================
REVOKE ALL ON public.passkey_challenges FROM anon;
REVOKE ALL ON public.passkey_challenges FROM authenticated;

-- ============================================================
-- C3: Revoke execute on handle_new_user_settings from anon/authenticated
-- ============================================================
REVOKE EXECUTE ON FUNCTION public.handle_new_user_settings() FROM anon;
REVOKE EXECUTE ON FUNCTION public.handle_new_user_settings() FROM authenticated;

-- ============================================================
-- M1: Set search_path on set_updated_at trigger function
-- ============================================================
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
