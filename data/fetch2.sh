get(){ Q="$1"; OUT=$2; for i in $(seq 1 30); do for u in https://overpass-api.de/api/interpreter https://overpass.private.coffee/api/interpreter https://overpass.kumi.systems/api/interpreter; do
 c=$(curl -s -m 400 -A "TruckNav/1.0 (github.com/Ace9x/truckers-gps)" -o $OUT -w "%{http_code}" --data-urlencode "data=$Q" $u); echo "$OUT $i $u $c $(stat -c%s $OUT)"
 [ "$c" = 200 ] && grep -q '"elements"' $OUT && ! grep -q '"remark"' $OUT && return 0; sleep 15; done; done; }
get '[out:json][timeout:350][bbox:38.4,-80.6,45.1,-66.9];way["highway"]["maxheight"~"^[0-9]"];out tags;' raw_h.json
get '[out:json][timeout:350][bbox:38.4,-80.6,45.1,-66.9];(way["highway"]["maxweight"~"^[0-9]"];way["highway"]["maxlength"~"^[0-9]"];way["highway"]["hazmat"="no"];way["highway"]["hgv"="no"]["highway"!~"footway|path|cycleway|service|track|pedestrian|steps"];);out tags;' raw_w.json
get '[out:json][timeout:350][bbox:38.4,-80.6,45.1,-66.9];nwr["amenity"="fuel"]["fuel:diesel"="yes"];out center tags;' raw_d.json
