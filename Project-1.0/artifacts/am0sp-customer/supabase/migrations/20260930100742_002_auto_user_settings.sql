/*
# Auto-create user_settings on signup

## Overview
When a new user registers, a row in user_settings should be automatically created
so the Appearance settings page always has data. This trigger fires after a new
auth.users row is inserted.

## Changes
- Creates a trigger function `handle_new_user_settings` that inserts a
  user_settings row with defaults for the new user.
- Attaches the trigger to auth.users AFTER INSERT.
*/

CREATE OR REPLACE FUNCTION public.handle_new_user_settings()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.user_settings (user_id)
  VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_settings();
