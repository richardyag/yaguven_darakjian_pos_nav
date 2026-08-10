# -*- coding: utf-8 -*-
{
    "name": "Darakjian — POS Navigation (facets + vertical tree)",
    "summary": "Faceted attribute filter bar and on-demand vertical category "
               "tree overlay for the Point of Sale product screen.",
    "description": """
Improves category navigation in the Point of Sale for Darakjian Jewelers:

* A **facet bar** driven by product attributes (metal, stone, type, price…),
  configurable from the settings — without touching any native model.
* A **vertical category tree** in an overlay, opened on demand, showing the full
  hierarchy without giving up the width of the product grid.

Responsive by design: enlarged touch targets on tablet (pointer: coarse) and a dense
view on desktop. All the logic lives inside the module, as inheritance and patches over
the native OWL Point of Sale, with no fields added to native models.
""",
    "version": "19.0.1.1.0",
    "category": "Point of Sale",
    "author": "Yagüven C.G.",
    "website": "https://github.com/GuvensConsultora/yaguven_darakjian_pos_nav",
    "license": "LGPL-3",
    # Solo nativo de Odoo (C.2): el POS y su framework. Nada de OCA/terceros.
    "depends": ["point_of_sale"],
    "data": [
        "security/ir.model.access.csv",
        "views/darakjian_pos_facet_views.xml",
    ],
    # Componentes OWL inyectados en el bundle del POS.
    "assets": {
        "point_of_sale._assets_pos": [
            "yaguven_darakjian_pos_nav/static/src/scss/pos_nav.scss",
            "yaguven_darakjian_pos_nav/static/src/app/store.js",
            "yaguven_darakjian_pos_nav/static/src/app/breadcrumb/breadcrumb.js",
            "yaguven_darakjian_pos_nav/static/src/app/breadcrumb/breadcrumb.xml",
            "yaguven_darakjian_pos_nav/static/src/app/facet_bar/facet_bar.js",
            "yaguven_darakjian_pos_nav/static/src/app/facet_bar/facet_bar.xml",
            "yaguven_darakjian_pos_nav/static/src/app/category_tree/category_tree.js",
            "yaguven_darakjian_pos_nav/static/src/app/category_tree/category_tree.xml",
            "yaguven_darakjian_pos_nav/static/src/overrides/product_screen.js",
            "yaguven_darakjian_pos_nav/static/src/overrides/payment_screen.js",
            "yaguven_darakjian_pos_nav/static/src/overrides/product_screen.xml",
            "yaguven_darakjian_pos_nav/static/src/overrides/product_card.xml",
        ],
    },
    "installable": True,
    "application": False,
    "auto_install": False,
}
