# DB ids created in the shared dev DB (HEL-1266), deleted by exact id only

Reused (NOT created, NOT deleted): data source 535f9759-d02e-441f-a3bb-3696b06342ce (HEL-1189 Skeptic Orders), user 9532cfcf-9882-45ba-8247-23706bc00113 (matt@helio.dev)

| kind | id | deleted |
|---|---|---|
| pipeline | b58b3714-d51a-4160-9f5a-e77c1bc67bb4 | yes, DELETE 204, GET 404 after |
| pipeline step (cascade) | 41e89177-e249-4bc4-a68d-10e0e16b25ff | cascaded with pipeline |
| pipeline root (cascade) | a202299d-2cc4-4193-b712-c4be47cea58b | cascaded with pipeline |
| pipeline | 58dcf8ff-f8f0-421d-8079-0ca10e03d72a (assert rules:[] probe, to confirm the e2e hel1096 denial mechanism has no validationError) | yes, DELETE 204, GET 404 after |
| pipeline step (cascade) | a62a5094-53ee-4f01-9ac1-2099337e3c65 | cascaded with pipeline |
| pipeline root (cascade) | fce1d63b-9506-4bae-acbd-0e93ad0faf83 | cascaded with pipeline |
