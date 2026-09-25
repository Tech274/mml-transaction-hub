
ALTER FUNCTION public.classify_transaction() SET search_path = public;
ALTER FUNCTION public.set_normalized_customer() SET search_path = public;
ALTER FUNCTION public.set_tx_actor() SET search_path = public;

REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.has_any_role(uuid, public.app_role[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, authenticated;
REVOKE EXECUTE ON FUNCTION public.log_transaction_activity() FROM PUBLIC, authenticated;
REVOKE EXECUTE ON FUNCTION public.classify_transaction() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_normalized_customer() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_tx_actor() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_any_role(uuid, public.app_role[]) TO authenticated;
