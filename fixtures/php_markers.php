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
