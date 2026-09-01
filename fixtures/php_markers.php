<p>Our hacky summer sale ends soon</p>
<!-- HACK: remove after 2024-03-01 -->
<?php
$kludge = 0;
// workaround until we upgrade
# hotfix for the session handler
#[Route('/kludge', name: 'hack_route')]
public function show(): string
{
    /* temporary fix — remove this when the bundle upgrades */
    $msg = "delete this when the user confirms";
    return $msg . $kludge;
}
// A date alone proves nothing: "# 2014-12-02 Add workaround" is an authored date
// rejected match matters: `$kludge = 0; // workaround until we upgrade` is a
// Workaround for the "flush on exit" bug in upstream
// "workaround until X" is the shape we look for
