export const location_state = {
        result: {
            response: [
                {
                    'code': '1',
                    'name': 'test_state_11',
                    'id': '4a6d77a1-6653-4e30-9be8-93371b6b53b78',
                    'type': 'state'
                  },
                  {
                    'code': '2',
                    'name': 'test_state_12',
                    'id': 'f1fe9665-bf2e-43cd-9063-57b0f33014b4',
                    'type': 'state'
                  },
                  {
                    'code': '3',
                    'name': 'test_state_13',
                    'id': 'f62a597d-17bd-499e-9565-734e3d556231',
                    'type': 'state'
                  },
                  {
                    'code': '4',
                    'name': 'test_state_14',
                    'id': 'f62a597d-17bd-499e-9565-734e3d556267',
                    'type': 'state'
                  }
                ]
    }
}
export const location_state_empty = {
    result: {
        response: [
            ]
}
}

export const location_district = {
    result: {
        response: [
              {
                "code": "2907",
                "name": "test_district_1",
                "id": "cde02789-5803-424b-a3f5-10db347280e9",
                "type": "district",
                "parentId": "4a6d77a1-6653-4e30-9be8-93371b6b53b78"
              },
              {
                "code": "2909",
                "name": "test_district_2",
                "id": "3ac37fb2-d833-45bf-a579-a2656b0cce62",
                "type": "district",
                "parentId": "4a6d77a1-6653-4e30-9be8-93371b6b53b78"
              }
            ]
}
}
export const location_district_empty = {
    result: {
        response: [
            ]
}
}
export const appUpdate = {
            updateAvailable: true,
            url: 'https://localhost:9000/app_updated.dmg',
            version: '1.0.2'
}
export const not_updated = {
            updateAvailable: false
}