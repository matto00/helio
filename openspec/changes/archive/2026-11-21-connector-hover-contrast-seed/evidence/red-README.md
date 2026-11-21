# Red run (HEL-1805), seed only, current CSS

Seed: no-auth rest_api connector (`https://guard-connector.invalid`), `/connectors` cells only. Create works on the lane backend with no extra key (no CONNECTOR_MASTER_KEY export was needed). `checkCreateTimeEgress` does at most a DNS lookup (ContentSourceSupport.checkEgress -> InetAddress.getAllByName), no HTTP/TCP.

Mounted controls: 1440 and 1100 = row, actions trigger, Test connection; 768 and 390 = row, actions trigger (Test connection is a menu item). Row/trigger/Test connection fail ~1.054 (light) / ~1.057 (dark) at every width, both themes.

NEW, outside the ticket's three controls: once a row exists the table overflows at 768/390, and the guard also fails (D4a absence): the focusable scroll region (768, 390) and the Credential / Dependents sortable header buttons (390 only). See the escalation.
