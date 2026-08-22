BEGIN{skip=0}
skip{ if ($0 ~ /}/) skip=0; next }
/^[[:space:]]*import[[:space:]]/ { if ($0 ~ /\{/ && $0 !~ /}/) skip=1; next }
/^[[:space:]]*package[[:space:]]+[A-Za-z_][A-Za-z0-9_.]*[[:space:]]*$/ { next }
{print}
